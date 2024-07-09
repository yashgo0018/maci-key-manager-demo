import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PubKey } from "maci-domainobjs";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { v4 as uuid } from "uuid";

const WS_URL = "ws://127.0.0.1:8080";

interface IMaciKeyContext {
  isConnected: boolean;
  publicKey: PubKey | null;
  uniqueId: string | null;
  disconnect: () => void;
  cancelLastSignatureRequest: () => void;
  signMessage: (data: any, hash: string) => string | undefined;
  lastSignature: { signatureId: string; signature: string } | null;
  pendingSignatureId: string | null;
}

export const MaciKeyContext = createContext<IMaciKeyContext>({} as IMaciKeyContext);

export const MaciKeyContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<PubKey | null>(null);
  const [uniqueId, setUniqueId] = useState<string | null>(null);
  const [pendingSignatureId, setPendingSignatureId] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<{ signatureId: string; signature: string } | null>(null);

  const { sendJsonMessage, readyState } = useWebSocket(WS_URL, {
    share: false,
    shouldReconnect: () => true,
    onMessage: message => {
      let data: any;
      try {
        data = JSON.parse(message.data);
      } catch (e) {
        console.error("Failed to parse message data", e);
        return;
      }

      console.log("Received message", data);

      switch (data.action) {
        case "get-id":
          setUniqueId(data.id);
          console.log("Received unique id", data.id);
          break;
        case "connected":
          setPublicKey(PubKey.deserialize(data.publicKey));
          setIsConnected(true);
          console.log("Connected to server");
          break;
        case "disconnected":
          setPublicKey(null);
          setIsConnected(false);
          console.log("Disconnected from server");
          break;
        case "signed":
          if (data.signatureId === pendingSignatureId) {
            setLastSignature({ signatureId: data.signatureId, signature: data.signature });
            setPendingSignatureId(null);
          }
          break;
        case "cancel-signature-request":
          if (data.signatureId === pendingSignatureId) {
            setPendingSignatureId(null);
          }
          break;
        case "pong":
          break;
        default:
          console.log("Unknown action", data.action);
      }
    },
  });

  useEffect(() => {
    console.log("Connection state changed");
    if (readyState === ReadyState.OPEN) {
      sendJsonMessage({
        action: "get-id",
      });
    }
  }, [readyState]);

  const disconnect = useCallback(() => {
    sendJsonMessage({
      action: "disconnect",
    });
  }, []);

  const signMessage = (data: any, hash: string) => {
    if (!isConnected) return;

    const signatureId = uuid();

    sendJsonMessage({
      action: "sign",
      signatureId,
      data,
      hash,
    });

    setPendingSignatureId(signatureId);
    return signatureId;
  };

  const cancelLastSignatureRequest = useCallback(() => {
    if (!pendingSignatureId) return;

    sendJsonMessage({
      action: "cancel-signature-request",
      signatureId: pendingSignatureId,
    });
  }, [pendingSignatureId]);

  useEffect(() => {
    setPendingSignatureId(null);
  }, [isConnected]);

  return (
    <MaciKeyContext.Provider
      value={{
        isConnected,
        publicKey,
        uniqueId,
        disconnect,
        lastSignature,
        pendingSignatureId,
        signMessage,
        cancelLastSignatureRequest,
      }}
    >
      {children}
    </MaciKeyContext.Provider>
  );
};

export const useMaciKeyContext = () => useContext(MaciKeyContext);
