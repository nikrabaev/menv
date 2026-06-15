// Renders the top of the modal stack in place of the pane area (header,
// status, and footer stay put — spatial memory survives modals).
import type React from "react";
import type { TuiContext } from "../state/data.ts";
import type { Store } from "../state/store.tsx";
import { FormModal } from "./formModal.tsx";
import { GenerateModal } from "./generateModal.tsx";
import { PlanConfirmModal } from "./planConfirm.tsx";
import {
  ConfirmModal,
  ConsumerPickModal,
  DetailModal,
  FindingsModal,
  HelpModal,
  OrphanPromptModal,
  QuitModal,
  RevealModal,
  UnlockModal,
} from "./simpleModals.tsx";
import { ValueEditModal } from "./valueEditModal.tsx";

export function ModalHost({ store, ctx }: { store: Store; ctx: TuiContext }): React.ReactElement | null {
  const modals = store.state.modals;
  const top = modals[modals.length - 1];
  if (top === undefined) return null;
  const onClose = (): void => store.dispatch({ type: "popModal" });
  switch (top.kind) {
    case "help":
      return <HelpModal isTop onClose={onClose} />;
    case "quit":
      return <QuitModal isTop onClose={onClose} />;
    case "plan":
      return <PlanConfirmModal title={top.title} op={top.op} danger={top.danger} apply={top.apply} isTop onClose={onClose} />;
    case "confirm":
      return <ConfirmModal title={top.title} body={top.body} danger={top.danger} onConfirm={top.onConfirm} isTop onClose={onClose} />;
    case "unlock":
      return <UnlockModal store={store} ctx={ctx} vault={top.vault} onUnlocked={top.onUnlocked} isTop onClose={onClose} />;
    case "form":
      return <FormModal form={top.form} isTop onClose={onClose} />;
    case "reveal":
      return <RevealModal variable={top.variable} vault={top.vault} consumer={top.consumer} value={top.value} isTop onClose={onClose} />;
    case "consumerPick":
      return <ConsumerPickModal title={top.title} consumers={top.consumers} onPick={top.onPick} isTop onClose={onClose} />;
    case "findings":
      return <FindingsModal store={store} isTop onClose={onClose} />;
    case "generate":
      return <GenerateModal store={store} ctx={ctx} isTop onClose={onClose} />;
    case "valueEdit":
      return <ValueEditModal store={store} ctx={ctx} name={top.name} vault={top.vault} consumer={top.consumer} isTop onClose={onClose} />;
    case "orphanPrompt":
      return <OrphanPromptModal vault={top.vault} keys={top.keys} onChoose={top.onChoose} isTop onClose={onClose} />;
    case "detail":
      return <DetailModal store={store} isTop onClose={onClose} />;
  }
}
