"use client";

import { useEffect, useState } from "react";
import type { Signature } from "maci-crypto";
import { genRandomSalt } from "maci-crypto";
import { Keypair, PCommand, PubKey } from "maci-domainobjs";
import { useContractRead, useContractWrite } from "wagmi";
import PollAbi from "~~/abi/Poll";
import VoteInProgress from "~~/app/polls/[id]/_components/VoteInProgress";
import VoteCard from "~~/components/card/VoteCard";
import { useAuthContext } from "~~/contexts/AuthContext";
import { useMaciKeyContext } from "~~/contexts/MaciKeyContext";
import { useFetchPoll } from "~~/hooks/useFetchPoll";
import { getPollStatus } from "~~/hooks/useFetchPolls";
import { PollStatus, PollType } from "~~/types/poll";
import { getDataFromPinata } from "~~/utils/pinata";
import { notification } from "~~/utils/scaffold-eth";

export default function PollDetail({ id }: { id: bigint }) {
  const { data: poll, error, isLoading } = useFetchPoll(id);
  const [pollType, setPollType] = useState(PollType.NOT_SELECTED);

  const { stateIndex, isRegistered } = useAuthContext();
  const { lastSignature, signMessage, publicKey, pendingSignatureId } = useMaciKeyContext();

  const [votes, setVotes] = useState<{ index: number; votes: number }[]>([]);

  const [isVotesInvalid, setIsVotesInvalid] = useState<Record<number, boolean>>({});

  const isAnyInvalid = Object.values(isVotesInvalid).some(v => v);
  const [result, setResult] = useState<{ candidate: string; votes: number }[] | null>(null);
  const [status, setStatus] = useState<PollStatus>();

  const [requiredSignatures, setRequiredSignatures] = useState<{
    messages: {
      messageHash: string;
      pollIndex: bigint;
      candidateIndex: bigint;
      weight: bigint;
      nonce: bigint;
    }[];
    signatureId: string;
  } | null>(null);

  useEffect(() => {
    if (
      !requiredSignatures ||
      requiredSignatures.signatureId !== lastSignature?.signatureId ||
      stateIndex === null ||
      !coordinatorPubKey ||
      !publicKey
    )
      return;

    const votesToMessage = requiredSignatures.messages.map(v =>
      encryptSignature(
        stateIndex,
        v.pollIndex,
        v.candidateIndex,
        v.weight,
        v.nonce,
        coordinatorPubKey,
        publicKey,
        lastSignature.signature,
      ),
    );

    setRequiredSignatures(null);

    (async () => {
      try {
        if (votesToMessage.length === 1) {
          await publishMessage({
            args: [
              votesToMessage[0].message.asContractParam() as unknown as {
                msgType: bigint;
                data: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
              },
              votesToMessage[0].encKeyPair.pubKey.asContractParam() as unknown as { x: bigint; y: bigint },
            ],
          });
        } else {
          await publishMessageBatch({
            args: [
              votesToMessage.map(
                v =>
                  v.message.asContractParam() as unknown as {
                    msgType: bigint;
                    data: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
                  },
              ),
              votesToMessage.map(v => v.encKeyPair.pubKey.asContractParam() as { x: bigint; y: bigint }),
            ],
          });
        }

        notification.success("Vote casted successfully");
      } catch (err) {
        console.log("err", err);
        notification.error("Casting vote failed, please try again ");
      }
    })();
  }, [lastSignature?.signatureId, requiredSignatures?.signatureId]);

  useEffect(() => {
    if (!poll || !poll.metadata) {
      return;
    }

    try {
      const { pollType } = JSON.parse(poll.metadata);
      setPollType(pollType);
    } catch (err) {
      console.log("err", err);
    }

    if (poll.tallyJsonCID) {
      (async () => {
        try {
          const {
            results: { tally },
          } = await getDataFromPinata(poll.tallyJsonCID);
          if (poll.options.length > tally.length) {
            throw new Error("Invalid tally data");
          }
          const tallyCounts: number[] = tally.map((v: string) => Number(v)).slice(0, poll.options.length);
          const result = [];
          for (let i = 0; i < poll.options.length; i++) {
            const candidate = poll.options[i];
            const votes = tallyCounts[i];
            result.push({ candidate, votes });
          }
          result.sort((a, b) => b.votes - a.votes);
          setResult(result);
          console.log("data", result);
        } catch (err) {
          console.log("err", err);
        }
      })();
    }

    const statusUpdateInterval = setInterval(async () => {
      setStatus(getPollStatus(poll));
    }, 1000);

    return () => {
      clearInterval(statusUpdateInterval);
    };
  }, [poll]);

  const { data: coordinatorPubKeyResult } = useContractRead({
    abi: PollAbi,
    address: poll?.pollContracts.poll,
    functionName: "coordinatorPubKey",
  });

  const { writeAsync: publishMessage } = useContractWrite({
    abi: PollAbi,
    address: poll?.pollContracts.poll,
    functionName: "publishMessage",
  });

  const { writeAsync: publishMessageBatch } = useContractWrite({
    abi: PollAbi,
    address: poll?.pollContracts.poll,
    functionName: "publishMessageBatch",
  });

  const [coordinatorPubKey, setCoordinatorPubKey] = useState<PubKey>();

  useEffect(() => {
    if (!coordinatorPubKeyResult) {
      return;
    }

    const coordinatorPubKey_ = new PubKey([
      BigInt((coordinatorPubKeyResult as any)[0].toString()),
      BigInt((coordinatorPubKeyResult as any)[1].toString()),
    ]);

    setCoordinatorPubKey(coordinatorPubKey_);
  }, [coordinatorPubKeyResult]);

  const castVote = async () => {
    if (!publicKey || !poll || stateIndex == null || !coordinatorPubKey || !isRegistered) return;

    // check if the votes are valid
    if (isAnyInvalid) {
      notification.error("Please enter a valid number of votes");
      return;
    }

    // check if no votes are selected
    if (votes.length === 0) {
      notification.error("Please select at least one option to vote");
      return;
    }

    // check if the poll is closed
    if (status !== PollStatus.OPEN) {
      notification.error("Voting is closed for this poll");
      return;
    }

    const votesToMessage = votes.map((v, i) => ({
      messageHash: getMessage(
        stateIndex,
        poll.id,
        BigInt(v.index),
        BigInt(v.votes),
        BigInt(votes.length - i),
        publicKey,
      ),
      pollIndex: poll.id,
      candidateIndex: BigInt(v.index),
      weight: BigInt(v.votes),
      nonce: BigInt(votes.length - i),
    }));

    const signatureId = signMessage(
      { pollId: Number(poll.id), title: poll?.name, selectedOption: poll?.options[Number(votes[0].index)] },
      votesToMessage[0].messageHash,
    );
    if (!signatureId) return;

    setRequiredSignatures({ messages: votesToMessage, signatureId });
  };

  function getMessage(
    stateIndex: bigint,
    pollIndex: bigint,
    candidateIndex: bigint,
    weight: bigint,
    nonce: bigint,
    publicKey: PubKey,
  ) {
    const command: PCommand = new PCommand(
      stateIndex,
      publicKey,
      candidateIndex,
      weight,
      nonce,
      pollIndex,
      genRandomSalt(),
    );

    return command.hash().toString();
  }

  function encryptSignature(
    stateIndex: bigint,
    pollIndex: bigint,
    candidateIndex: bigint,
    weight: bigint,
    nonce: bigint,
    coordinatorPubKey: PubKey,
    publicKey: PubKey,
    signature: string,
  ) {
    const command: PCommand = new PCommand(
      stateIndex,
      publicKey,
      candidateIndex,
      weight,
      nonce,
      pollIndex,
      genRandomSalt(),
    );

    const encKeyPair = new Keypair();

    const formatedSignature: Signature = JSON.parse(signature);

    const message = command.encrypt(formatedSignature, Keypair.genEcdhSharedKey(encKeyPair.privKey, coordinatorPubKey));

    return { message, encKeyPair };
  }

  function voteUpdated(index: number, checked: boolean, voteCounts: number) {
    if (pollType === PollType.SINGLE_VOTE) {
      if (checked) {
        setVotes([{ index, votes: voteCounts }]);
      }
      return;
    }

    if (checked) {
      setVotes([...votes.filter(v => v.index !== index), { index, votes: voteCounts }]);
    } else {
      setVotes(votes.filter(v => v.index !== index));
    }
  }

  if (isLoading) return <div>Loading...</div>;

  if (error) return <div>Poll not found</div>;

  return (
    <div className="container mx-auto pt-10">
      <div className="flex h-full flex-col md:w-2/3 lg:w-1/2 mx-auto">
        <div className="flex flex-row items-center my-5">
          <div className="text-2xl font-bold ">Vote for {poll?.name}</div>
        </div>
        {poll?.options.map((candidate, index) => (
          <div className="pb-5 flex" key={index}>
            <VoteCard
              pollOpen={status === PollStatus.OPEN}
              index={index}
              candidate={candidate}
              clicked={false}
              pollType={pollType}
              onChange={(checked, votes) => voteUpdated(index, checked, votes)}
              isInvalid={Boolean(isVotesInvalid[index])}
              setIsInvalid={status => setIsVotesInvalid({ ...isVotesInvalid, [index]: status })}
            />
          </div>
        ))}
        {status === PollStatus.OPEN && (
          <div className={`mt-2 shadow-2xl`}>
            <button
              onClick={castVote}
              disabled={!true}
              className="hover:border-black border-2 border-accent w-full text-lg text-center bg-accent py-3 rounded-xl font-bold"
            >
              {true ? "Vote Now" : "Voting Closed"}{" "}
            </button>
          </div>
        )}

        {result && (
          <div className="mt-5">
            <div className="text-2xl font-bold">Results</div>
            <div className="mt-3">
              <table className="border-separate w-full mt-7 mb-4">
                <thead>
                  <tr className="text-lg font-extralight">
                    <th className="border border-slate-600 bg-primary">Rank</th>
                    <th className="border border-slate-600 bg-primary">Candidate</th>
                    <th className="border border-slate-600 bg-primary">Votes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.map((r, i) => (
                    <tr key={i} className="text-center">
                      <td>{i + 1}</td>
                      <td>{r.candidate}</td>
                      <td>{r.votes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {pendingSignatureId !== null && pendingSignatureId !== lastSignature?.signatureId && <VoteInProgress />}
    </div>
  );
}
