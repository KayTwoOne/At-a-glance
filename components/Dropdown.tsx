/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, ReactDOM } from "@webpack/common";

import { useOnLightTheme } from "./appearance";
import { ChevronIcon } from "./icons";

export interface DropdownOption {
    label: string;
    value: string;
}

interface DropdownProps {
    options: DropdownOption[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
    className?: string;
}

/**
 * Fully themed dropdown. A native <select> renders its option list with the
 * OS's default (light) chrome, which is unreadable over Discord's dark UI.
 *
 * The menu is portaled to <body> and positioned `fixed` off the trigger's
 * rect: widget cards animate in with a lingering `translateY(0)` transform,
 * which would otherwise make the menu a *containing block* child and push it
 * off-screen. The portal escapes every ancestor transform/overflow.
 */
export function Dropdown({ options, value, onChange, ariaLabel, className }: DropdownProps) {
    // The menu is portaled past .vc-glance-layer's DOM subtree (see below), so
    // it can't inherit .vc-glance-on-light from an ancestor the way the
    // trigger does - it needs its own light-theme read to match.
    const onLightTheme = useOnLightTheme();
    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [rect, setRect] = React.useState<{ top: number; left: number; width: number; } | null>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);

    const selected = options.find(o => o.value === value) ?? options[0];

    React.useEffect(() => {
        if (!open) return;

        const update = () => {
            const r = triggerRef.current?.getBoundingClientRect();
            if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width });
        };
        update();

        // Close on any click outside BOTH the trigger and the portaled menu
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("scroll", update, true);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("scroll", update, true);
            window.removeEventListener("resize", update);
        };
    }, [open]);

    const commit = (v: string) => {
        onChange(v);
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex(Math.max(0, options.findIndex(o => o.value === value)));
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case "Escape":
                e.preventDefault();
                setOpen(false);
                break;
            case "ArrowDown":
                e.preventDefault();
                setActiveIndex(i => Math.min(options.length - 1, i + 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                setActiveIndex(i => Math.max(0, i - 1));
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                commit(options[activeIndex].value);
                break;
        }
    };

    const menu = open && rect && (
        <div
            ref={menuRef}
            className={"vc-glance-dropdown-menu" + (onLightTheme ? " vc-glance-on-light" : "")}
            role="listbox"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
        >
            {options.map((option, i) => (
                <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={
                        "vc-glance-dropdown-item"
                        + (option.value === value ? " vc-glance-dropdown-item-selected" : "")
                        + (i === activeIndex ? " vc-glance-dropdown-item-active" : "")
                    }
                    onClick={() => commit(option.value)}
                    onMouseEnter={() => setActiveIndex(i)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );

    return (
        <div
            ref={rootRef}
            className={"vc-glance-dropdown" + (className ? ` ${className}` : "")}
            tabIndex={0}
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
        >
            <button
                ref={triggerRef}
                type="button"
                className="vc-glance-dropdown-trigger"
                onClick={() => setOpen(o => !o)}
                tabIndex={-1}
            >
                <span className="vc-glance-dropdown-value">{selected?.label}</span>
                <ChevronIcon className={"vc-glance-dropdown-caret" + (open ? " vc-glance-dropdown-caret-open" : "")} size={14} />
            </button>
            {menu && ReactDOM.createPortal(menu, document.body)}
        </div>
    );
}
