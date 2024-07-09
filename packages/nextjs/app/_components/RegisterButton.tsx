import QRCode from "react-qr-code";
import { useAuthContext } from "~~/contexts/AuthContext";
import { useMaciKeyContext } from "~~/contexts/MaciKeyContext";
import { useScaffoldContractWrite } from "~~/hooks/scaffold-eth";

export default function RegisterButton() {
  const { isRegistered } = useAuthContext();
  const { uniqueId, publicKey } = useMaciKeyContext();

  const { writeAsync } = useScaffoldContractWrite({
    contractName: "MACIWrapper",
    functionName: "signUp",
    args: [publicKey?.asContractParam() as { x: bigint; y: bigint }, "0x", "0x"],
  });

  console.log(publicKey);

  async function register() {
    if (!publicKey) return;

    try {
      await writeAsync({ args: [publicKey.asContractParam() as { x: bigint; y: bigint }, "0x", "0x"] });
    } catch (err) {
      console.log(err);
    }
  }

  if (!uniqueId) {
    return <div></div>;
  }

  if (!publicKey) {
    console.log("sdfs", publicKey);
    return (
      <div>
        <QRCode className="mx-auto" value={JSON.stringify({ webId: uniqueId.toString() })} />
      </div>
    );
  }

  if (isRegistered) return <div>Thanks for Registration</div>;

  return (
    <>
      (You are not registered yet)
      <button className="border border-slate-600 bg-primary px-3 py-2 rounded-lg font-bold" onClick={register}>
        Register
      </button>
    </>
  );
}
