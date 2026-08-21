/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface IconProps {
    className?: string;
    size?: number;
}

function svgProps({ className, size = 20 }: IconProps) {
    return {
        className,
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "currentColor",
        "aria-hidden": true
    } as const;
}

/** Four rounded tiles - the Dashboard tab icon */
export function DashboardIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4Zm9 0A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5v4A1.5 1.5 0 0 1 18.5 11h-4A1.5 1.5 0 0 1 13 9.5v-4Zm-9 9A1.5 1.5 0 0 1 5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4Zm9 0a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" />
        </svg>
    );
}

export function SpeakerIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 3.37a1 1 0 0 0-1.62-.78L6.15 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.15l4.23 3.41A1 1 0 0 0 12 20.63V3.37ZM15.1 8.48a1 1 0 0 1 1.42 0 5 5 0 0 1 0 7.04 1 1 0 1 1-1.42-1.4 3 3 0 0 0 0-4.24 1 1 0 0 1 0-1.4Z" />
            <path d="M18.36 5.64a1 1 0 0 1 1.41 0 9 9 0 0 1 0 12.72 1 1 0 1 1-1.41-1.41 7 7 0 0 0 0-9.9 1 1 0 0 1 0-1.41Z" />
        </svg>
    );
}

export function HashIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M9.86 3.02a1 1 0 0 1 .84 1.14L10.32 7h4.66l.44-3.16a1 1 0 0 1 1.98.3L17 7h2.5a1 1 0 1 1 0 2h-2.78l-.86 6H18.5a1 1 0 1 1 0 2h-2.92l-.44 3.16a1 1 0 0 1-1.98-.3L13.6 17H8.94l-.44 3.16a1 1 0 0 1-1.98-.3L7 17H4.5a1 1 0 1 1 0-2h2.78l.86-6H5.5a1 1 0 0 1 0-2h2.92l.44-3.14a1 1 0 0 1 1-.84ZM10.04 9l-.86 6h4.66l.86-6h-4.66Z" />
        </svg>
    );
}

export function CloseIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M18.7 5.3a1 1 0 0 0-1.4 0L12 10.59 6.7 5.3a1 1 0 1 0-1.4 1.4L10.59 12 5.3 17.3a1 1 0 1 0 1.4 1.4L12 13.41l5.3 5.29a1 1 0 0 0 1.4-1.4L13.41 12l5.29-5.3a1 1 0 0 0 0-1.4Z" />
        </svg>
    );
}

export function ArrowIcon({ direction, ...props }: IconProps & { direction: "up" | "down" | "left" | "right"; }) {
    const rotation = { up: 0, right: 90, down: 180, left: 270 }[direction];
    return (
        <svg {...svgProps(props)} style={{ transform: `rotate(${rotation}deg)` }}>
            <path d="M12 4.7a1 1 0 0 1 .7.3l6 6a1 1 0 0 1-1.4 1.4L13 8.11V18.3a1 1 0 1 1-2 0V8.1l-4.3 4.3a1 1 0 1 1-1.4-1.4l6-6a1 1 0 0 1 .7-.3Z" />
        </svg>
    );
}

export function PlusIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" />
        </svg>
    );
}

/** Solid right-pointing triangle - play/start */
export function PlayIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
        </svg>
    );
}

/** Rounded square - stop */
export function StopIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    );
}

/** Vertical kebab (row actions) */
export function DotsIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
        </svg>
    );
}

/** Six-dot grip, purely decorative on widget headers */
export function GripIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M9 5.5A1.5 1.5 0 1 1 9 8.5a1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-6 5A1.5 1.5 0 1 1 9 13.5a1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-6 5A1.5 1.5 0 1 1 9 18.5a1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
        </svg>
    );
}

export function ChatIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 3c5 0 9 3.58 9 8s-4 8-9 8c-1.06 0-2.08-.16-3.02-.44L4.6 20.4a.8.8 0 0 1-1.1-.87l.62-3.42A7.42 7.42 0 0 1 3 11c0-4.42 4-8 9-8Z" />
        </svg>
    );
}

export function MusicIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M19.7 3.06a1 1 0 0 1 .3.71v10.48a3.25 3.25 0 1 1-2-3V7.1l-8 1.8v7.85a3.25 3.25 0 1 1-2-3V6.5a1 1 0 0 1 .78-.98l10-2.25a1 1 0 0 1 .92.23Z" />
        </svg>
    );
}

/** Chevron pointing right; rotate via CSS class for expanded state */
export function ChevronIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4L14.59 12 9.3 6.7a1 1 0 0 1 0-1.4Z" />
        </svg>
    );
}

export function MicIcon({ muted, ...props }: IconProps & { muted?: boolean; }) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" />
            <path d="M6 11a1 1 0 1 0-2 0 8 8 0 0 0 7 7.94V21a1 1 0 1 0 2 0v-2.06A8 8 0 0 0 20 11a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z" />
            {muted && <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 0 0 1.4-1.4l-16-16Z" />}
        </svg>
    );
}

export function HeadphonesIcon({ deafened, ...props }: IconProps & { deafened?: boolean; }) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 4a7 7 0 0 0-7 7v1.1A3 3 0 0 0 3 15v2a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-.9A5 5 0 0 1 12 6a5 5 0 0 1 5.9 6H17a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-2a3 3 0 0 0-2-2.83V11a7 7 0 0 0-7-7Z" />
            {deafened && <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 0 0 1.4-1.4l-16-16Z" />}
        </svg>
    );
}

export function GearIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M10.3 3.6a2 2 0 0 1 3.4 0l.53.86a2 2 0 0 0 2.12.88l.98-.23a2 2 0 0 1 2.4 2.4l-.22.98a2 2 0 0 0 .88 2.12l.85.53a2 2 0 0 1 0 3.4l-.85.53a2 2 0 0 0-.88 2.12l.22.98a2 2 0 0 1-2.4 2.4l-.98-.22a2 2 0 0 0-2.12.88l-.53.85a2 2 0 0 1-3.4 0l-.53-.85a2 2 0 0 0-2.12-.88l-.98.22a2 2 0 0 1-2.4-2.4l.23-.98a2 2 0 0 0-.88-2.12l-.86-.53a2 2 0 0 1 0-3.4l.86-.53a2 2 0 0 0 .88-2.12l-.23-.98a2 2 0 0 1 2.4-2.4l.98.23a2 2 0 0 0 2.12-.88l.53-.86ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        </svg>
    );
}

export function SendIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M3.7 3.2a1 1 0 0 1 1.05-.14l16 8a1 1 0 0 1 0 1.88l-16 8A1 1 0 0 1 3.4 19.6L5.53 13H11a1 1 0 1 0 0-2H5.53L3.4 4.4a1 1 0 0 1 .3-1.2Z" />
        </svg>
    );
}

export function PhoneIcon({ slash, ...props }: IconProps & { slash?: boolean; }) {
    return (
        <svg {...svgProps(props)}>
            <path d="M7.72 3.52a2 2 0 0 0-2.9-.1L3.5 4.74a3 3 0 0 0-.83 2.83c.6 2.6 2.1 5.6 4.62 8.13 2.53 2.53 5.53 4.03 8.13 4.63a3 3 0 0 0 2.83-.83l1.32-1.32a2 2 0 0 0-.1-2.9l-2.28-2a2 2 0 0 0-2.42-.15l-1.06.7a.55.55 0 0 1-.62 0 15.1 15.1 0 0 1-2.05-1.72 15.1 15.1 0 0 1-1.72-2.05.55.55 0 0 1 0-.62l.7-1.06a2 2 0 0 0-.15-2.42l-2-2.28Z" />
            {slash && <path d="M4.7 2.3a1 1 0 0 0-1.4 1.4l17 17a1 1 0 0 0 1.4-1.4l-17-17Z" />}
        </svg>
    );
}

export function BellIcon({ filled, ...props }: IconProps & { filled?: boolean; }) {
    return (
        <svg {...svgProps(props)}>
            {filled
                ? <path d="M12 2a7 7 0 0 0-7 7v3.6l-1.7 2.55A1 1 0 0 0 4.13 17h15.74a1 1 0 0 0 .83-1.55L19 12.6V9a7 7 0 0 0-7-7Zm-2.45 16a2.5 2.5 0 0 0 4.9 0h-4.9Z" />
                : <path d="M12 2a7 7 0 0 0-7 7v3.6l-1.7 2.55A1 1 0 0 0 4.13 17h15.74a1 1 0 0 0 .83-1.55L19 12.6V9a7 7 0 0 0-7-7Zm5 10.9.9 1.35-.15.75H6.1l.9-2.1V9a5 5 0 1 1 10 0v3.9ZM9.55 18a2.5 2.5 0 0 0 4.9 0h-4.9Z" />
            }
        </svg>
    );
}

export function BookmarkIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21a1 1 0 0 1-1.55.83L12 18.7l-4.45 3.13A1 1 0 0 1 6 21V3.5Z" />
        </svg>
    );
}

export function CheckIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M20.7 6.3a1 1 0 0 1 0 1.4l-10 10a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4L10 15.59l9.3-9.3a1 1 0 0 1 1.4 0Z" />
        </svg>
    );
}

export function VideoIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2.2l3.4 2.55A1 1 0 0 0 20 15.5v-7a1 1 0 0 0-1.6-.85L15 10.2V8a2 2 0 0 0-2-2H4Z" />
        </svg>
    );
}

/** Open eye with an optional diagonal slash - privacy/visibility toggle.
 *  The pupil is cut out of the outer eye shape with fillRule="evenodd"
 *  rather than drawn as a second same-colour circle, or it would just merge
 *  into the outline instead of reading as a hole. */
export function EyeIcon({ slash, ...props }: IconProps & { slash?: boolean; }) {
    return (
        <svg {...svgProps(props)}>
            <path
                fillRule="evenodd"
                d="M2 12A10 6 0 0 1 22 12 10 6 0 0 1 2 12ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
            />
            {slash && <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 0 0 1.4-1.4l-16-16Z" />}
        </svg>
    );
}

export function PaletteIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 2.5-2.5c0-.61-.22-1.17-.59-1.6-.36-.43-.58-.87-.58-1.4a2.5 2.5 0 0 1 2.5-2.5H19a3 3 0 0 0 3-3c0-3.87-4.48-7-10-7Zm-4.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM9 8.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm5.5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
        </svg>
    );
}

/** Arrow pointing out of a box - "go to channel" */
export function ExternalIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M14 4a1 1 0 1 1 0-2h7a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V5.41l-8.3 8.3a1 1 0 0 1-1.4-1.42L18.58 4H14Z" />
            <path d="M4 6a2 2 0 0 1 2-2h4a1 1 0 1 1 0 2H6v12h12v-4a1 1 0 1 1 2 0v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
        </svg>
    );
}

/** Two overlapping figures - people/friends */
export function PeopleIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M8 9.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM8 11c-3.31 0-6 2.24-6 5.5v1a1 1 0 0 0 1 1h6.5v-2a6.4 6.4 0 0 1 2.02-4.64A7.6 7.6 0 0 0 8 11ZM15.5 11.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM15.5 13c-3.87 0-7 2.69-7 6v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1c0-3.31-3.13-6-7-6Z" />
        </svg>
    );
}

/** Ring-bound page - a calendar with two hangers */
export function CalendarIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M5.5 4A2.5 2.5 0 0 0 3 6.5v12A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5v-12A2.5 2.5 0 0 0 18.5 4h-13ZM7 1.75a1 1 0 0 1 1 1V5H6V2.75a1 1 0 0 1 1-1Zm10 0a1 1 0 0 1 1 1V5h-2V2.75a1 1 0 0 1 1-1Z" />
        </svg>
    );
}

/** Sun with eight rays - generic weather glyph, actual conditions render as emoji in the widget body */
export function WeatherIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4ZM11 1H13V4H11ZM11 20H13V23H11ZM1 11H4V13H1ZM20 11H23V13H20ZM3.5 3.5H5.5V5.5H3.5ZM18.5 3.5H20.5V5.5H18.5ZM3.5 18.5H5.5V20.5H3.5ZM18.5 18.5H20.5V20.5H18.5Z" />
        </svg>
    );
}

/** Page with a folded corner - a note */
export function NoteIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9.41a2 2 0 0 0-.59-1.42l-5.4-5.4A2 2 0 0 0 12.6 2H6Z" />
        </svg>
    );
}

/** Ascending bars - client performance / activity */
export function PulseIcon(props: IconProps) {
    return (
        <svg {...svgProps(props)}>
            <path d="M3 12a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-3 0v-5.5A1.5 1.5 0 0 1 3 12ZM10 6a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-3 0V7.5A1.5 1.5 0 0 1 10 6ZM17 9a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-3 0v-8.5A1.5 1.5 0 0 1 17 9Z" />
        </svg>
    );
}
