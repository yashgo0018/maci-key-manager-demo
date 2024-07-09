import { Dialog } from "@headlessui/react";
import Modal from "~~/components/Modal";
import { useMaciKeyContext } from "~~/contexts/MaciKeyContext";

export default function VoteInProgress() {
  const { cancelLastSignatureRequest } = useMaciKeyContext();

  return (
    <Modal show={true} setOpen={v => !v && cancelLastSignatureRequest()}>
      <div className="mt-3 text-center sm:mt-5 mb-6">
        <Dialog.Title as="h3" className="font-bold leading-6 text-2xl text-neutral-content">
          Sign the message on the Key Manager
        </Dialog.Title>
      </div>

      <div className="mt-5 sm:mt-6 sm:gap-3">
        <button
          type="button"
          className="mt-3 w-full inline-flex w-full justify-center rounded-md bg-white px-3 py-2 font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0"
          onClick={() => cancelLastSignatureRequest()}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
