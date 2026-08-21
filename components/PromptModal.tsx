/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Modal, React } from "@webpack/common";

import { openGlanceModal, useGlanceModalGuard } from "./modals";

interface PromptOptions {
    title: string;
    placeholder: string;
    initialValue?: string;
    maxLength: number;
    multiline?: boolean;
    onSubmit: (value: string) => void;
}

function PromptModalInner({ title, placeholder, initialValue, maxLength, multiline, onSubmit, modalProps }: PromptOptions & { modalProps: RenderModalProps; }) {
    useGlanceModalGuard();
    const [value, setValue] = React.useState(initialValue ?? "");

    const submit = () => {
        onSubmit(value.trim());
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={title}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Save", variant: "primary", onClick: submit }
            ]}
        >
            {multiline
                ? (
                    <textarea
                        className="vc-glance-notes vc-glance-prompt-input"
                        autoFocus
                        value={value}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        onChange={e => setValue(e.target.value)}
                    />
                )
                : (
                    <input
                        className="vc-glance-input vc-glance-prompt-input"
                        autoFocus
                        type="text"
                        value={value}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") submit(); }}
                    />
                )
            }
        </Modal>
    );
}

/** Opens a small native-modal input prompt; submit gets the trimmed value */
export function openPrompt(options: PromptOptions) {
    openGlanceModal(modalProps => (
        <PromptModalInner {...options} modalProps={modalProps} />
    ));
}

interface ConfirmOptions {
    title: string;
    body: string;
    confirmText: string;
    onConfirm: () => void;
}

function ConfirmModalInner({ title, body, confirmText, onConfirm, modalProps }: ConfirmOptions & { modalProps: RenderModalProps; }) {
    useGlanceModalGuard();

    return (
        <Modal
            {...modalProps}
            size="sm"
            title={title}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                {
                    text: confirmText,
                    variant: "critical-primary",
                    onClick: () => {
                        onConfirm();
                        modalProps.onClose();
                    }
                }
            ]}
        >
            <p className="vc-glance-confirm-body">{body}</p>
        </Modal>
    );
}

/** Opens a small native-modal yes/no prompt for a destructive action -
 *  never a browser confirm(), which cannot be styled or themed and stalls
 *  the whole renderer thread while it's up. */
export function openConfirm(options: ConfirmOptions) {
    openGlanceModal(modalProps => (
        <ConfirmModalInner {...options} modalProps={modalProps} />
    ));
}
