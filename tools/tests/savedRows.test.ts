/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createMigrationQueue, dueChip, entryKey, flattenMarkdown, type LocalBookmark,
    mergeReminders, messageChips, type MigrationState, previewText, type SavedEntry
} from "../../savedRows";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A local-time instant, with a 1-based month so the dates read like the labels
const local = (y: number, month: number, d: number, h = 0, mi = 0) => new Date(y, month - 1, d, h, mi).getTime();
const settle = () => new Promise(resolve => setImmediate(resolve));

function entry(over: { message?: SavedEntry["message"]; summary?: string; } = {}): SavedEntry {
    return {
        message: "message" in over ? over.message ?? null : { content: "hello" },
        saveData: {
            channelId: "100", messageId: "200", savedAt: new Date(0),
            authorSummary: "kay", channelSummary: "general", messageSummary: over.summary ?? ""
        }
    };
}

// flattenMarkdown

test("flattenMarkdown strips bold, underline, italic and strikethrough markers", () => {
    assert.equal(flattenMarkdown("**bold**"), "bold");
    assert.equal(flattenMarkdown("__under__"), "under");
    assert.equal(flattenMarkdown("*lean*"), "lean");
    assert.equal(flattenMarkdown("_lean_"), "lean");
    assert.equal(flattenMarkdown("~~gone~~"), "gone");
    assert.equal(flattenMarkdown("a **b** and _c_ and ~~d~~ e"), "a b and c and d e");
});

test("flattenMarkdown strips nested and stacked markers", () => {
    assert.equal(flattenMarkdown("***both***"), "both");
    assert.equal(flattenMarkdown("**bold *and lean* text**"), "bold and lean text");
    assert.equal(flattenMarkdown("*lean **and bold** text*"), "lean and bold text");
    assert.equal(flattenMarkdown("__*mixed*__"), "mixed");
    assert.equal(flattenMarkdown("~~**both**~~"), "both");
});

test("flattenMarkdown leaves characters that only look like markers", () => {
    assert.equal(flattenMarkdown("see snake_case_name here"), "see snake_case_name here");
    assert.equal(flattenMarkdown("my_var_ is"), "my_var_ is");
    assert.equal(flattenMarkdown("an _a_b word"), "an _a_b word");
    assert.equal(flattenMarkdown("a_file__name_ here"), "a_file__name_ here");
    assert.equal(flattenMarkdown("2 * 3 * 4"), "2 * 3 * 4");
    assert.equal(flattenMarkdown("a lone * star"), "a lone * star");
    assert.equal(flattenMarkdown("https://x.com/_user_/status"), "https://x.com/_user_/status");
    assert.equal(flattenMarkdown("<https://x.com/_a_>"), "https://x.com/_a_");
});

test("flattenMarkdown never shows a spoiler", () => {
    const out = flattenMarkdown("the answer is ||forty two||");
    assert.equal(out, "the answer is [spoiler]");
    assert.ok(!out.includes("forty"));
    assert.equal(flattenMarkdown("||a|| and ||b||"), "[spoiler] and [spoiler]");
});

test("flattenMarkdown hides a spoiler that spans lines or holds other markup", () => {
    assert.equal(flattenMarkdown("x ||line one\nline two|| y"), "x [spoiler] y");
    assert.equal(flattenMarkdown("||**bold** <@123> `code` https://secret.example||"), "[spoiler]");
    assert.equal(flattenMarkdown("||```\nsecret\n```||"), "[spoiler]");
});

test("flattenMarkdown turns inline code into its plain text and keeps its markers", () => {
    assert.equal(flattenMarkdown("run `npm test` now"), "run npm test now");
    assert.equal(flattenMarkdown("`a*b*c`"), "a*b*c");
    assert.equal(flattenMarkdown("`||not a spoiler||`"), "||not a spoiler||");
    assert.equal(flattenMarkdown("``a`b``"), "a`b");
});

test("flattenMarkdown turns a fenced block into [code]", () => {
    assert.equal(flattenMarkdown("```js\nconst a = 1;\n```"), "[code]");
    assert.equal(flattenMarkdown("try this:\n```\nfoo\nbar\n```\nthanks"), "try this: [code] thanks");
    assert.equal(flattenMarkdown("```a``` and ```b```"), "[code] and [code]");
});

test("flattenMarkdown turns mentions into plain words", () => {
    assert.equal(flattenMarkdown("hi <@123456789012345678>"), "hi @user");
    assert.equal(flattenMarkdown("hi <@!123456789012345678>"), "hi @user");
    assert.equal(flattenMarkdown("see <#123456789012345678>"), "see #channel");
    assert.equal(flattenMarkdown("ping <@&123456789012345678>"), "ping @role");
    assert.equal(flattenMarkdown("@everyone and @here"), "@everyone and @here");
});

test("flattenMarkdown turns custom emoji into :name:", () => {
    assert.equal(flattenMarkdown("<:wave:123456789012345678>"), ":wave:");
    assert.equal(flattenMarkdown("<a:party_parrot:123456789012345678> yes"), ":party_parrot: yes");
});

test("flattenMarkdown unwraps <link> and keeps bare links whole", () => {
    assert.equal(flattenMarkdown("<https://example.com/a?b=1>"), "https://example.com/a?b=1");
    assert.equal(flattenMarkdown("read **https://example.com/x**"), "read https://example.com/x");
    assert.equal(flattenMarkdown("go to https://example.com/a_b_c now"), "go to https://example.com/a_b_c now");
});

test("flattenMarkdown collapses whitespace and newlines and trims", () => {
    assert.equal(flattenMarkdown("  a \n\n b\t\tc  "), "a b c");
    assert.equal(flattenMarkdown(""), "");
    assert.equal(flattenMarkdown(" \n "), "");
});

test("flattenMarkdown copes with a realistic message", () => {
    const content = "**Heads up** <@!1> and <@&2>, see <#3>:\n```ts\nlet x = 1;\n```\nSpoiler: ||it ends well|| <:ok:4> https://example.com/a_b";
    assert.equal(
        flattenMarkdown(content),
        "Heads up @user and @role, see #channel: [code] Spoiler: [spoiler] :ok: https://example.com/a_b"
    );
});

test("flattenMarkdown cannot be fooled by its own placeholder characters", () => {
    assert.equal(flattenMarkdown("`secret` \uE0000\uE001"), "secret 0");
});

// flattenMarkdown: where code and spoilers meet

test("flattenMarkdown: a spoiler ends at the first || even when that cuts through inline code", () => {
    const out = flattenMarkdown("The answer is ||don't use `eval||, use `JSON.parse`");
    assert.ok(!out.includes("don't use"), out);
    assert.ok(!out.includes("eval"), out);
    assert.equal(out, "The answer is [spoiler], use JSON.parse");
});

test("flattenMarkdown: a spoiler ends at the first || even when that is inside a fence", () => {
    const out = flattenMarkdown("||secret plot ```||``` x");
    assert.ok(!out.includes("secret plot"), out);
    assert.equal(out.startsWith("[spoiler]"), true);
});

test("flattenMarkdown: code that starts before a spoiler opener keeps its bars", () => {
    assert.equal(flattenMarkdown("`a||b` ||c||"), "a||b [spoiler]");
    assert.equal(flattenMarkdown("`a ||b`|| c"), "a ||b|| c");
    assert.equal(flattenMarkdown("```\n||x||\n``` ||y||"), "[code] [spoiler]");
});

test("flattenMarkdown: an opener inside an unclosed backtick still hides its text", () => {
    const out = flattenMarkdown("`a ||secret|| b");
    assert.ok(!out.includes("secret"), out);
    assert.equal(out, "`a [spoiler] b");
});

test("flattenMarkdown: a spoiler hides code, fences and links it holds", () => {
    const out = flattenMarkdown("||`one` ```two``` https://three.example||");
    assert.equal(out, "[spoiler]");
});

test("flattenMarkdown: an empty || pair is not a spoiler", () => {
    assert.equal(flattenMarkdown("a |||| b"), "a |||| b");
});

// flattenMarkdown: unclosed bars, in a message and in a summary

test("flattenMarkdown leaves an unclosed || as typed, as Discord shows it", () => {
    assert.equal(flattenMarkdown("the twist is ||he was dead"), "the twist is ||he was dead");
    assert.equal(flattenMarkdown("a || b"), "a || b");
});

test("flattenMarkdown in summary mode hides everything after an unclosed ||", () => {
    const out = flattenMarkdown("the twist is ||he was dead all al", { summary: true });
    assert.equal(out, "the twist is [spoiler]");
    assert.ok(!out.includes("dead"));
    assert.equal(flattenMarkdown("x ||a|| y ||b", { summary: true }), "x [spoiler] y [spoiler]");
    assert.equal(flattenMarkdown("x ||a|", { summary: true }), "x [spoiler]");
});

test("flattenMarkdown in summary mode reads a summary with no bars the same as ever", () => {
    assert.equal(flattenMarkdown("**hi** `there`", { summary: true }), "hi there");
    assert.equal(flattenMarkdown("x ||a|| y", { summary: true }), "x [spoiler] y");
    assert.equal(flattenMarkdown("x `||` y", { summary: true }), "x || y");
});

// flattenMarkdown: backslash escapes

test("flattenMarkdown turns a backslash escape into the literal character", () => {
    assert.equal(flattenMarkdown("\\*not bold\\*"), "*not bold*");
    assert.equal(flattenMarkdown("\\_not\\_ lean"), "_not_ lean");
    assert.equal(flattenMarkdown("\\~\\~not\\~\\~"), "~~not~~");
    assert.equal(flattenMarkdown("\\<@123> stays"), "<@123> stays");
    assert.equal(flattenMarkdown("\\`not code\\`"), "`not code`");
    assert.equal(flattenMarkdown("a \\\\ b"), "a \\ b");
});

test("flattenMarkdown: an escaped bar does not make a spoiler", () => {
    assert.equal(flattenMarkdown("\\|\\|x\\|\\|"), "||x||");
    // the first bar is escaped, so the pair is broken before it can open
    assert.equal(flattenMarkdown("\\||x||"), "||x||");
});

test("flattenMarkdown keeps a backslash that escapes nothing", () => {
    assert.equal(flattenMarkdown("C:\\users\\kay"), "C:\\users\\kay");
    assert.equal(flattenMarkdown("a\\ b"), "a\\ b");
    assert.equal(flattenMarkdown("1\\2"), "1\\2");
    assert.equal(flattenMarkdown("trailing\\"), "trailing\\");
});

test("flattenMarkdown does not read escapes inside code", () => {
    assert.equal(flattenMarkdown("`\\*x\\*`"), "\\*x\\*");
    assert.equal(flattenMarkdown("```\n\\*x\n```"), "[code]");
});

test("flattenMarkdown escapes a whole emoji, not half of one", () => {
    assert.equal(flattenMarkdown("\\\u{1F600}x"), "\u{1F600}x");
});

// flattenMarkdown: timestamps, commands and Discord's own links

test("flattenMarkdown writes <t:N> as an absolute local date, in any style", () => {
    const stamp = Math.floor(local(2026, 10, 20, 14, 5) / 1000);
    assert.equal(flattenMarkdown(`at <t:${stamp}>`), "at 20 OCT 2026 14:05");
    for (const style of ["t", "T", "d", "D", "f", "F", "R"]) {
        assert.equal(flattenMarkdown(`<t:${stamp}:${style}>`), "20 OCT 2026 14:05", style);
    }
    const early = Math.floor(local(2027, 1, 3, 9, 7) / 1000);
    assert.equal(flattenMarkdown(`<t:${early}:R>`), "3 JAN 2027 09:07");
});

test("flattenMarkdown does not try to date a timestamp that is out of range", () => {
    assert.equal(flattenMarkdown("<t:99999999999999999>"), "[date]");
});

test("flattenMarkdown writes a slash command as /name, subcommands included", () => {
    assert.equal(flattenMarkdown("run </ping:123456789012345678>"), "run /ping");
    assert.equal(flattenMarkdown("</cmd sub:123456789012345678>"), "/cmd sub");
    assert.equal(flattenMarkdown("</cmd group sub:123456789012345678>"), "/cmd group sub");
    assert.equal(flattenMarkdown("</my-cmd_2:1>"), "/my-cmd_2");
});

test("flattenMarkdown names Discord's guide links", () => {
    assert.equal(flattenMarkdown("<id:customize>"), "Channels & Roles");
    assert.equal(flattenMarkdown("<id:browse>"), "Browse Channels");
    assert.equal(flattenMarkdown("<id:guide>"), "Server Guide");
    assert.equal(flattenMarkdown("<id:linked-roles>"), "Linked Roles");
    assert.equal(flattenMarkdown("<id:linked-roles:123456789012345678>"), "Linked Roles");
    assert.equal(flattenMarkdown("see <id:guide> or <id:browse>"), "see Server Guide or Browse Channels");
});

// flattenMarkdown: masked links, headings, subtext and quotes

test("flattenMarkdown keeps only the text of a masked link", () => {
    assert.equal(flattenMarkdown("[click here](https://example.com)"), "click here");
    assert.equal(flattenMarkdown("[click here](<https://example.com/a>)"), "click here");
    assert.equal(flattenMarkdown("see [the docs](https://example.com/a?b=1) now"), "see the docs now");
    assert.equal(flattenMarkdown("[**bold** text](https://example.com)"), "bold text");
    assert.equal(flattenMarkdown("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))"), "wiki");
    assert.equal(flattenMarkdown("[titled](https://example.com \"A title\")"), "titled");
});

test("flattenMarkdown leaves brackets that are not a masked link", () => {
    assert.equal(flattenMarkdown("[not a link](not a url)"), "[not a link](not a url)");
    assert.equal(flattenMarkdown("[just brackets]"), "[just brackets]");
    assert.equal(flattenMarkdown("array[0](1)"), "array[0](1)");
});

test("flattenMarkdown does not let a masked link reveal a spoiler or read inside code", () => {
    assert.equal(flattenMarkdown("[||secret||](https://example.com)"), "[spoiler]");
    assert.equal(flattenMarkdown("`[a](https://b.example)`"), "[a](https://b.example)");
});

test("flattenMarkdown strips heading and subtext markers at the start of a line", () => {
    assert.equal(flattenMarkdown("# Title\nbody"), "Title body");
    assert.equal(flattenMarkdown("## Sub\n### Smaller"), "Sub Smaller");
    assert.equal(flattenMarkdown("-# small print"), "small print");
    assert.equal(flattenMarkdown("intro\n# Head\n-# fine"), "intro Head fine");
});

test("flattenMarkdown leaves hashes and dashes that are not markers", () => {
    assert.equal(flattenMarkdown("#hashtag"), "#hashtag");
    assert.equal(flattenMarkdown("#### four"), "#### four");
    assert.equal(flattenMarkdown("issue # 5"), "issue # 5");
    assert.equal(flattenMarkdown("- list item"), "- list item");
    assert.equal(flattenMarkdown("\\# not a heading"), "# not a heading");
    assert.equal(flattenMarkdown("```\n# in code\n```"), "[code]");
});

test("flattenMarkdown strips quote markers at the start of a line", () => {
    assert.equal(flattenMarkdown("> quoted"), "quoted");
    assert.equal(flattenMarkdown(">>> long\nquote"), "long quote");
    assert.equal(flattenMarkdown("reply\n> said this\nmore"), "reply said this more");
    assert.equal(flattenMarkdown("a > b"), "a > b");
    assert.equal(flattenMarkdown(">no space"), ">no space");
});

// messageChips

test("messageChips is empty for no message, or a bare one", () => {
    assert.deepEqual(messageChips(null), []);
    assert.deepEqual(messageChips({}), []);
    assert.deepEqual(messageChips({ attachments: [], embeds: [], content: "just words" }), []);
});

test("messageChips gives one file chip per attachment, in order", () => {
    assert.deepEqual(
        messageChips({ attachments: [{ filename: "a.png" }, { filename: "notes.pdf" }] }),
        [{ kind: "file", label: "a.png" }, { kind: "file", label: "notes.pdf" }]
    );
});

test("messageChips truncates long filenames to 28 characters including the dots", () => {
    const exact = "a".repeat(24) + ".png";
    assert.equal(exact.length, 28);
    assert.equal(messageChips({ attachments: [{ filename: exact }] })[0].label, exact);
    const over = "a".repeat(25) + ".png";
    const [{ label }] = messageChips({ attachments: [{ filename: over }] });
    assert.equal(label.length, 28);
    assert.equal(label, "a".repeat(25) + "...");
});

test("messageChips truncates by whole characters, not halves of an emoji", () => {
    const [{ label }] = messageChips({ attachments: [{ filename: "\u{1F600}".repeat(40) + ".png" }] });
    assert.equal(Array.from(label).length, 28);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label));
});

test("messageChips names an attachment that has no filename", () => {
    assert.deepEqual(messageChips({ attachments: [{}, { filename: "" }] }), [
        { kind: "file", label: "attachment" }, { kind: "file", label: "attachment" }
    ]);
});

test("messageChips counts links in the content", () => {
    assert.deepEqual(messageChips({ content: "see https://a.example" }), [{ kind: "links", label: "1 link" }]);
    assert.deepEqual(
        messageChips({ content: "http://a.example then <https://b.example/x?y=1> and https://a.example" }),
        [{ kind: "links", label: "3 links" }]
    );
    assert.deepEqual(messageChips({ content: "ftp://nope.example and example.com" }), []);
});

test("messageChips shows an embed chip only when there are embeds and no links", () => {
    assert.deepEqual(messageChips({ embeds: [{}] }), [{ kind: "embed", label: "1 embed" }]);
    assert.deepEqual(messageChips({ embeds: [{}, {}] }), [{ kind: "embed", label: "2 embeds" }]);
    assert.deepEqual(
        messageChips({ embeds: [{}], content: "https://a.example" }),
        [{ kind: "links", label: "1 link" }]
    );
});

test("messageChips lists files first, then links, then embeds", () => {
    assert.deepEqual(
        messageChips({ attachments: [{ filename: "x.zip" }], content: "https://a.example https://b.example", embeds: [{}] }),
        [{ kind: "file", label: "x.zip" }, { kind: "links", label: "2 links" }]
    );
    assert.deepEqual(
        messageChips({ attachments: [{ filename: "x.zip" }], embeds: [{}] }),
        [{ kind: "file", label: "x.zip" }, { kind: "embed", label: "1 embed" }]
    );
});

test("messageChips shows a SPOILER_ attachment as a spoiler, never by name", () => {
    assert.deepEqual(
        messageChips({ attachments: [{ filename: "SPOILER_cat.png" }, { filename: "spoiler_Dog.PNG" }, { filename: "Spoiler_x" }] }),
        [{ kind: "file", label: "spoiler" }, { kind: "file", label: "spoiler" }, { kind: "file", label: "spoiler" }]
    );
    for (const chip of messageChips({ attachments: [{ filename: "SPOILER_the_butler_did_it.png" }] })) {
        assert.ok(!chip.label.includes("butler"));
    }
});

test("messageChips names an attachment that only looks like a spoiler", () => {
    assert.deepEqual(
        messageChips({ attachments: [{ filename: "not_SPOILER_x.png" }, { filename: "spoilers.png" }, { filename: "SPOILER.png" }] }),
        [{ kind: "file", label: "not_SPOILER_x.png" }, { kind: "file", label: "spoilers.png" }, { kind: "file", label: "SPOILER.png" }]
    );
});

test("messageChips does not count a link inside a spoiler", () => {
    assert.deepEqual(messageChips({ content: "look ||https://secret.example||" }), []);
    assert.deepEqual(
        messageChips({ content: "||https://a.example|| and https://b.example" }),
        [{ kind: "links", label: "1 link" }]
    );
    assert.deepEqual(messageChips({ content: "||secret <https://a.example>|| but https://b.example" }), [{ kind: "links", label: "1 link" }]);
});

test("messageChips counts a link that comes after a spoiler which cut through code", () => {
    assert.deepEqual(messageChips({ content: "||see `x|| https://a.example`" }), [{ kind: "links", label: "1 link" }]);
    assert.deepEqual(messageChips({ content: "||see `https://hidden.example|| ok `" }), []);
});

test("messageChips does not count a link inside code", () => {
    assert.deepEqual(messageChips({ content: "run `curl https://a.example`" }), []);
    assert.deepEqual(messageChips({ content: "```\nhttps://a.example\n```" }), []);
    assert.deepEqual(
        messageChips({ content: "`https://a.example` and https://b.example and https://c.example" }),
        [{ kind: "links", label: "2 links" }]
    );
});

test("messageChips counts a link in a message with an unclosed spoiler bar", () => {
    assert.deepEqual(messageChips({ content: "a || https://a.example" }), [{ kind: "links", label: "1 link" }]);
});

test("messageChips counts a masked link once", () => {
    assert.deepEqual(messageChips({ content: "[the docs](https://a.example/x)" }), [{ kind: "links", label: "1 link" }]);
});

test("messageChips shows the embed chip when the only link is hidden", () => {
    assert.deepEqual(
        messageChips({ content: "||https://a.example||", embeds: [{}] }),
        [{ kind: "embed", label: "1 embed" }]
    );
});

// previewText

test("previewText shows the message's text, flattened", () => {
    assert.equal(
        previewText(entry({ message: { content: "**hi** ||secret|| <@1>" }, summary: "stale summary" })),
        "hi [spoiler] @user"
    );
});

test("previewText falls back to the summary when the message is null", () => {
    assert.equal(previewText(entry({ message: null, summary: "kay: remember the milk" })), "kay: remember the milk");
});

test("previewText falls back to the summary when the message has no text", () => {
    assert.equal(previewText(entry({ message: { content: "" }, summary: "from the summary" })), "from the summary");
    assert.equal(previewText(entry({ message: { content: "  \n " }, summary: "from the summary" })), "from the summary");
    assert.equal(previewText(entry({ message: {}, summary: "from the summary" })), "from the summary");
});

test("previewText never shows a spoiler that came through the summary", () => {
    const out = previewText(entry({ message: null, summary: "the twist is ||he was dead all along||" }));
    assert.equal(out, "the twist is [spoiler]");
});

test("previewText hides what follows an unclosed || in a summary, which Discord truncates", () => {
    const out = previewText(entry({ message: null, summary: "kay: the twist is ||he was dead all al" }));
    assert.equal(out, "kay: the twist is [spoiler]");
    assert.ok(!out.includes("dead"));
});

test("previewText leaves an unclosed || in the live message as typed", () => {
    assert.equal(previewText(entry({ message: { content: "a || b" } })), "a || b");
});

test("previewText never shows a spoiler that code cut open, in either source", () => {
    const text = "The answer is ||don't use `eval||, use `JSON.parse`";
    for (const out of [previewText(entry({ message: { content: text } })), previewText(entry({ message: null, summary: text }))]) {
        assert.ok(!out.includes("eval"), out);
        assert.equal(out, "The answer is [spoiler], use JSON.parse");
    }
});

test("previewText says (attachment) for an attachment-only message", () => {
    assert.equal(
        previewText(entry({ message: { content: "", attachments: [{ filename: "a.png" }] } })),
        "(attachment)"
    );
});

test("previewText says (no text) when there is nothing at all", () => {
    assert.equal(previewText(entry({ message: null })), "(no text)");
    assert.equal(previewText(entry({ message: { content: "", attachments: [] } })), "(no text)");
    assert.equal(previewText(entry({ message: { content: "" }, summary: "   " })), "(no text)");
});

test("previewText prefers a non-empty summary to the attachment placeholder", () => {
    assert.equal(
        previewText(entry({ message: { content: "", attachments: [{ filename: "a.png" }] }, summary: "sent a photo" })),
        "sent a photo"
    );
});

// entryKey

test("entryKey joins the channel and message ids", () => {
    assert.equal(entryKey(entry()), "100-200");
});

// dueChip

const now = local(2026, 10, 20, 8, 0);

test("dueChip counts overdue minutes under an hour", () => {
    assert.deepEqual(dueChip(now - 59 * MIN, now), { label: "OVERDUE 59 MIN", tone: "over" });
    assert.deepEqual(dueChip(now - (59 * MIN + 59_000), now), { label: "OVERDUE 59 MIN", tone: "over" });
    assert.deepEqual(dueChip(now - 5 * MIN, now), { label: "OVERDUE 5 MIN", tone: "over" });
});

test("dueChip rounds the first minute of lateness up to one", () => {
    assert.deepEqual(dueChip(now - 30_000, now), { label: "OVERDUE 1 MIN", tone: "over" });
    assert.deepEqual(dueChip(now, now), { label: "OVERDUE 1 MIN", tone: "over" });
});

test("dueChip switches from minutes to hours at exactly 60 minutes overdue", () => {
    assert.deepEqual(dueChip(now - 60 * MIN, now), { label: "OVERDUE 1 H", tone: "over" });
    assert.deepEqual(dueChip(now - 90 * MIN, now), { label: "OVERDUE 1 H", tone: "over" });
    assert.deepEqual(dueChip(now - 47 * HOUR, now), { label: "OVERDUE 47 H", tone: "over" });
    assert.deepEqual(dueChip(now - (47 * HOUR + 59 * MIN), now), { label: "OVERDUE 47 H", tone: "over" });
});

test("dueChip switches from hours to days at exactly 48 hours overdue", () => {
    assert.deepEqual(dueChip(now - 48 * HOUR, now), { label: "OVERDUE 2 D", tone: "over" });
    assert.deepEqual(dueChip(now - 5 * DAY, now), { label: "OVERDUE 5 D", tone: "over" });
});

test("dueChip counts minutes to go under an hour", () => {
    assert.deepEqual(dueChip(now + 59 * MIN, now), { label: "IN 59 MIN", tone: "soon" });
    assert.deepEqual(dueChip(now + 30 * MIN, now), { label: "IN 30 MIN", tone: "soon" });
    assert.deepEqual(dueChip(now + 30_000, now), { label: "IN 1 MIN", tone: "soon" });
});

test("dueChip switches to hours at exactly 60 minutes to go", () => {
    assert.deepEqual(dueChip(now + 60 * MIN, now), { label: "IN 1 H", tone: "soon" });
    assert.deepEqual(dueChip(now + 23 * HOUR, now), { label: "IN 23 H", tone: "soon" });
    assert.deepEqual(dueChip(now + (24 * HOUR - MIN), now), { label: "IN 23 H", tone: "soon" });
});

test("dueChip says TOMORROW for the next calendar day, from 24 hours out", () => {
    assert.deepEqual(dueChip(now + 24 * HOUR, now), { label: "TOMORROW 08:00", tone: "later" });
    assert.deepEqual(dueChip(local(2026, 10, 21, 9, 5), now), { label: "TOMORROW 09:05", tone: "later" });
    assert.deepEqual(dueChip(local(2026, 10, 21, 23, 59), now), { label: "TOMORROW 23:59", tone: "later" });
});

test("dueChip decides tomorrow by the calendar, not by a count of hours", () => {
    const lateNow = local(2026, 10, 20, 23, 0);
    assert.deepEqual(dueChip(local(2026, 10, 21, 23, 30), lateNow), { label: "TOMORROW 23:30", tone: "later" });
    // 25.5 hours ahead, but already the day after tomorrow
    assert.deepEqual(dueChip(local(2026, 10, 22, 0, 30), lateNow), { label: "22 OCT 00:30", tone: "later" });
    // a few minutes ahead and across midnight stays "soon"
    assert.deepEqual(dueChip(local(2026, 10, 21, 0, 10), lateNow), { label: "IN 1 H", tone: "soon" });
});

test("dueChip shows day, month and 24-hour time beyond tomorrow", () => {
    assert.deepEqual(dueChip(local(2026, 11, 3, 9, 0), now), { label: "3 NOV 09:00", tone: "later" });
    assert.deepEqual(dueChip(local(2026, 11, 3, 9, 5), now), { label: "3 NOV 09:05", tone: "later" });
    assert.deepEqual(dueChip(local(2026, 10, 27, 18, 30), now), { label: "27 OCT 18:30", tone: "later" });
    assert.deepEqual(dueChip(local(2026, 10, 22, 0, 0), now), { label: "22 OCT 00:00", tone: "later" });
});

test("dueChip names every month in upper-case English", () => {
    const names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    names.forEach((name, i) => {
        assert.equal(dueChip(local(2027, i + 1, 15, 12, 0), now).label, `15 ${name} 12:00`);
    });
});

test("dueChip does not print NaN for a date it cannot read", () => {
    assert.deepEqual(dueChip(Number.NaN, now), { label: "NO DATE", tone: "later" });
    assert.deepEqual(dueChip(Number.POSITIVE_INFINITY, now), { label: "NO DATE", tone: "later" });
    assert.deepEqual(dueChip(now + HOUR, Number.NaN), { label: "NO DATE", tone: "later" });
});

// mergeReminders

test("mergeReminders orders overdue first, then by due time, untimed last", () => {
    const base = 1_700_000_000_000;
    const merged = mergeReminders(
        [
            { dueAt: base + 5 * DAY, item: { id: "native-later" } },
            { dueAt: base - HOUR, item: { id: "native-overdue" } }
        ],
        [
            { dueAt: null, item: { text: "note-a" } },
            { dueAt: base + 2 * HOUR, item: { text: "local-timed" } },
            { dueAt: null, item: { text: "note-b" } }
        ]
    );
    assert.deepEqual(merged, [
        { kind: "native", item: { id: "native-overdue" }, dueAt: base - HOUR },
        { kind: "local", item: { text: "local-timed" }, dueAt: base + 2 * HOUR },
        { kind: "native", item: { id: "native-later" }, dueAt: base + 5 * DAY },
        { kind: "local", item: { text: "note-a" }, dueAt: null },
        { kind: "local", item: { text: "note-b" }, dueAt: null }
    ]);
});

test("mergeReminders interleaves native and local reminders by due time", () => {
    const merged = mergeReminders(
        [{ dueAt: 10, item: "n10" }, { dueAt: 30, item: "n30" }],
        [{ dueAt: 20, item: "l20" }, { dueAt: 5, item: "l5" }, { dueAt: 40, item: "l40" }]
    );
    assert.deepEqual(merged.map(m => m.item), ["l5", "n10", "l20", "n30", "l40"]);
});

test("mergeReminders puts a native reminder before a local one due at the same moment", () => {
    const merged = mergeReminders([{ dueAt: 10, item: "n" }], [{ dueAt: 10, item: "l" }]);
    assert.deepEqual(merged.map(m => m.kind), ["native", "local"]);
});

test("mergeReminders keeps the original order of equal times and of untimed notes", () => {
    const merged = mergeReminders(
        [{ dueAt: 10, item: "n1" }, { dueAt: 10, item: "n2" }],
        [{ dueAt: null, item: "z" }, { dueAt: null, item: "a" }, { dueAt: null, item: "m" }]
    );
    assert.deepEqual(merged.map(m => m.item), ["n1", "n2", "z", "a", "m"]);
});

test("mergeReminders handles empty lists and leaves its inputs alone", () => {
    assert.deepEqual(mergeReminders([], []), []);
    const native = [{ dueAt: 2, item: "n2" }, { dueAt: 1, item: "n1" }];
    const localList = [{ dueAt: null, item: "x" }, { dueAt: 0, item: "y" }];
    mergeReminders(native, localList);
    assert.deepEqual(native.map(n => n.item), ["n2", "n1"]);
    assert.deepEqual(localList.map(n => n.item), ["x", "y"]);
    assert.deepEqual(mergeReminders([], [{ dueAt: null, item: "only" }]).map(m => m.item), ["only"]);
});

test("mergeReminders treats a local reminder due at time zero as timed, not untimed", () => {
    const merged = mergeReminders([{ dueAt: 5, item: "n" }], [{ dueAt: 0, item: "zero" }, { dueAt: null, item: "note" }]);
    assert.deepEqual(merged.map(m => m.item), ["zero", "n", "note"]);
});

// createMigrationQueue

// "ok" resolves, "reject" throws an Error, anything else is thrown as it stands
function queueHarness(results: Array<string | object>) {
    const log: string[] = [];
    const states: MigrationState[] = [];
    const waits: number[] = [];
    const removed: string[] = [];
    let call = 0;
    const deps = {
        async save(item: LocalBookmark) {
            const result = results[call++] ?? "ok";
            log.push("save:" + item.messageId);
            if (result === "reject") throw new Error("Rate limited");
            if (result !== "ok") throw result;
        },
        removeLocal(messageId: string) {
            removed.push(messageId);
            log.push("remove:" + messageId);
        },
        async wait(ms: number) {
            waits.push(ms);
            log.push("wait");
        },
        onChange(state: MigrationState) { states.push(state); }
    };
    return { deps, log, states, waits, removed };
}

const items: LocalBookmark[] = [
    { channelId: "c1", messageId: "m1" },
    { channelId: "c1", messageId: "m2" },
    { channelId: "c2", messageId: "m3" }
];

test("a queue starts idle", () => {
    const h = queueHarness([]);
    const queue = createMigrationQueue(h.deps);
    assert.deepEqual(queue.state(), { running: false, done: 0, failed: [], total: 0 });
});

test("a queue moves [ok, reject, ok]: done 2, failed 1, two local copies removed", async () => {
    const h = queueHarness(["ok", "reject", "ok"]);
    const queue = createMigrationQueue(h.deps);
    const final = await queue.run(items);
    assert.deepEqual(final, {
        running: false, done: 2, failed: [{ messageId: "m2", reason: "Rate limited" }], total: 3
    });
    assert.deepEqual(queue.state(), final);
    assert.deepEqual(h.removed, ["m1", "m3"]);
});

test("a queue saves one at a time, removes after each save, and waits between saves", async () => {
    const h = queueHarness(["ok", "reject", "ok"]);
    await createMigrationQueue(h.deps).run(items);
    assert.deepEqual(h.log, [
        "save:m1", "remove:m1", "wait",
        "save:m2", "wait",
        "save:m3", "remove:m3"
    ]);
    assert.deepEqual(h.waits, [400, 400]);
});

test("a queue uses the gap it is given, and does not wait after a lone item", async () => {
    const h = queueHarness([]);
    await createMigrationQueue(h.deps, 1500).run(items);
    assert.deepEqual(h.waits, [1500, 1500]);
    const lone = queueHarness([]);
    await createMigrationQueue(lone.deps).run([items[0]]);
    assert.deepEqual(lone.waits, []);
});

test("a queue reports progress through onChange", async () => {
    const h = queueHarness(["ok", "reject", "ok"]);
    await createMigrationQueue(h.deps).run(items);
    assert.deepEqual(
        h.states.map(s => [s.running, s.done, s.failed.length, s.total]),
        [[true, 0, 0, 3], [true, 1, 0, 3], [true, 1, 1, 3], [true, 2, 1, 3], [false, 2, 1, 3]]
    );
});

test("a queue hands out snapshots, so a listener cannot change its state", async () => {
    const h = queueHarness(["reject"]);
    const queue = createMigrationQueue(h.deps);
    await queue.run([items[0]]);
    queue.state().failed.push({ messageId: "x", reason: "tampered" });
    h.states[h.states.length - 1].failed.length = 0;
    assert.equal(queue.state().failed.length, 1);
});

test("a queue never removes a local copy until its save has resolved", async () => {
    const log: string[] = [];
    let finishSave!: () => void;
    const queue = createMigrationQueue({
        save: () => new Promise<void>(resolve => { finishSave = () => { log.push("saved"); resolve(); }; }),
        removeLocal: id => { log.push("remove:" + id); },
        wait: async () => {},
        onChange: () => {}
    });
    const running = queue.run([items[0]]);
    await settle();
    assert.deepEqual(log, []);
    finishSave();
    await running;
    assert.deepEqual(log, ["saved", "remove:m1"]);
});

test("a queue keeps the local copy of every failed save and carries on", async () => {
    const h = queueHarness(["reject", "reject", "reject"]);
    const final = await createMigrationQueue(h.deps).run(items);
    assert.equal(final.done, 0);
    assert.deepEqual(final.failed.map(f => f.messageId), ["m1", "m2", "m3"]);
    assert.deepEqual(h.removed, []);
});

test("a queue turns whatever a rejection holds into a readable reason", async () => {
    const h = queueHarness([
        { body: { message: "You are being rate limited." } },
        { message: "Unknown Message" },
        { text: "Service unavailable" }
    ]);
    const final = await createMigrationQueue(h.deps).run(items);
    assert.deepEqual(final.failed.map(f => f.reason), [
        "You are being rate limited.", "Unknown Message", "Service unavailable"
    ]);
    const odd = queueHarness([{}, { body: {} }, "plain words"]);
    const second = await createMigrationQueue(odd.deps).run(items);
    assert.deepEqual(second.failed.map(f => f.reason), ["Unknown error", "Unknown error", "plain words"]);
});

test("a queue counts a failed removal as a failure and keeps the item for next time", async () => {
    const h = queueHarness([]);
    const queue = createMigrationQueue({
        ...h.deps,
        removeLocal: () => { throw new Error("disk full"); }
    });
    const final = await queue.run([items[0]]);
    assert.equal(final.done, 0);
    assert.deepEqual(final.failed, [{ messageId: "m1", reason: "disk full" }]);
});

test("a second run during the first returns the same promise and starts nothing new", async () => {
    let finishSave!: () => void;
    let saves = 0;
    const queue = createMigrationQueue({
        save: () => { saves++; return new Promise<void>(resolve => { finishSave = resolve; }); },
        removeLocal: () => {},
        wait: async () => {},
        onChange: () => {}
    });
    const first = queue.run([items[0]]);
    await settle();
    assert.equal(queue.state().running, true);
    const second = queue.run(items);
    assert.equal(second, first);
    assert.equal(saves, 1);
    finishSave();
    const final = await first;
    assert.equal(final.total, 1);
    assert.equal(final.done, 1);
    assert.equal(saves, 1);
});

test("pressing again after a run resumes with the items that failed", async () => {
    const h = queueHarness(["ok", "reject", "ok", "ok"]);
    const queue = createMigrationQueue(h.deps);
    const first = await queue.run(items);
    assert.equal(first.failed.length, 1);
    const retry = queue.run(items.filter(i => first.failed.some(f => f.messageId === i.messageId)));
    assert.equal(queue.state().running, true);
    const second = await retry;
    assert.deepEqual(second, { running: false, done: 1, failed: [], total: 1 });
    assert.deepEqual(h.removed, ["m1", "m3", "m2"]);
});

test("a queue given nothing finishes straight away", async () => {
    const h = queueHarness([]);
    const queue = createMigrationQueue(h.deps);
    const final = await queue.run([]);
    assert.deepEqual(final, { running: false, done: 0, failed: [], total: 0 });
    assert.deepEqual(h.waits, []);
});

test("a queue stops reporting itself as running even if its wait throws", async () => {
    const h = queueHarness([]);
    const queue = createMigrationQueue({ ...h.deps, wait: async () => { throw new Error("timer gone"); } });
    await assert.rejects(queue.run(items), /timer gone/);
    assert.equal(queue.state().running, false);
    // not stuck: a later run starts afresh instead of returning the dead promise
    const again = await queue.run([items[0]]);
    assert.equal(again.done, 1);
    assert.equal(again.running, false);
});

test("a queue still attempts every item when removeLocal splices the caller's own array", async () => {
    const source: LocalBookmark[] = [
        { channelId: "c1", messageId: "m1" },
        { channelId: "c1", messageId: "m2" },
        { channelId: "c2", messageId: "m3" },
        { channelId: "c2", messageId: "m4" }
    ];
    const attempted: string[] = [];
    const queue = createMigrationQueue({
        save: async item => { attempted.push(item.messageId); },
        // what a real caller does: drop the saved item from the list it passed in
        removeLocal: id => { source.splice(source.findIndex(b => b.messageId === id), 1); },
        wait: async () => {},
        onChange: () => {}
    });
    const final = await queue.run(source);
    assert.deepEqual(attempted, ["m1", "m2", "m3", "m4"]);
    assert.deepEqual(final, { running: false, done: 4, failed: [], total: 4 });
    assert.deepEqual(source, []);
});

test("a queue is not left running when its first onChange throws", async () => {
    let calls = 0;
    const h = queueHarness([]);
    const queue = createMigrationQueue({
        ...h.deps,
        onChange: () => { if (++calls === 1) throw new Error("listener broke"); }
    });
    await assert.rejects(queue.run(items), /listener broke/);
    assert.equal(queue.state().running, false);
    assert.deepEqual(h.log, []);
    // not stuck: the next press starts afresh
    const again = await queue.run(items);
    assert.equal(again.done, 3);
    assert.equal(again.running, false);
});
