"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useMaciKeyContext } from "./MaciKeyContext";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldContractRead, useScaffoldEventHistory, useScaffoldEventSubscriber } from "~~/hooks/scaffold-eth";
import scaffoldConfig from "~~/scaffold.config";

interface IAuthContext {
  isRegistered: boolean;
  stateIndex: bigint | null;
}

export const AuthContext = createContext<IAuthContext>({} as IAuthContext);

export default function AuthContextProvider({ children }: { children: React.ReactNode }) {
  const [stateIndex, setStateIndex] = useState<bigint | null>(null);
  const { publicKey } = useMaciKeyContext();

  const { data: isRegistered, refetch: refetchIsRegistered } = useScaffoldContractRead({
    contractName: "MACIWrapper",
    functionName: "isPublicKeyRegistered",
    args: publicKey ? publicKey.rawPubKey : [0n, 0n],
  });

  const chainId = scaffoldConfig.targetNetworks[0].id;

  const {
    MACIWrapper: { deploymentBlockNumber },
  } = deployedContracts[chainId];

  const { data: SignUpEvents } = useScaffoldEventHistory({
    contractName: "MACIWrapper",
    eventName: "SignUp",
    filters: {
      _userPubKeyX: BigInt(publicKey?.asContractParam().x || 0n),
      _userPubKeyY: BigInt(publicKey?.asContractParam().y || 0n),
    },
    fromBlock: BigInt(deploymentBlockNumber),
  });

  useEffect(() => {
    console.log(publicKey, SignUpEvents);
    if (!publicKey || !SignUpEvents || !SignUpEvents.length) {
      setStateIndex(null);
      return;
    }

    const event = SignUpEvents.filter(
      log =>
        log.args._userPubKeyX?.toString() === publicKey.asContractParam().x &&
        log.args._userPubKeyY?.toString() === publicKey.asContractParam().y,
    )[0];
    console.log(event);
    setStateIndex(event?.args?._stateIndex || null);
  }, [publicKey, SignUpEvents]);

  console.log({ publicKey, SignUpEvents });

  useScaffoldEventSubscriber({
    contractName: "MACIWrapper",
    eventName: "SignUp",
    listener: logs => {
      logs.forEach(log => {
        if (
          log.args._userPubKeyX !== publicKey?.asContractParam().x ||
          log.args._userPubKeyY !== publicKey?.asContractParam().y
        )
          return;
        refetchIsRegistered();
        setStateIndex(log.args._stateIndex || null);
      });
    },
  });

  return (
    <AuthContext.Provider value={{ isRegistered: Boolean(isRegistered), stateIndex }}>{children}</AuthContext.Provider>
  );
}

export const useAuthContext = () => useContext(AuthContext);
