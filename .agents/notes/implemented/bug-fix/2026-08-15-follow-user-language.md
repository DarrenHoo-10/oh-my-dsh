# Agent Note: Follow the user's language

Status: implemented

English | [中文](2026-08-15-follow-user-language.zh.md)

## Problem

The shipped UI locale affects client strings but does not enter model context. Models therefore receive predominantly English system and tool instructions and may answer a Chinese message with English prose or expose English reasoning summaries and tool-call descriptions.

## Decision

Every shipped deployment persona and agent-preset persona asks the model to use the latest user message's language for all natural-language output unless the user requests another language. The instruction covers reasoning summaries and tool-call descriptions while preserving code, commands, identifiers, paths, and quotations.

The rule belongs in shipped personas rather than the client locale. It therefore applies consistently to Web, desktop, headless, resumed sessions, forks, and side chats without coupling model behavior to one presentation client. A user-authored persona remains authoritative and may replace the rule.

## Verification

The keyless Web minimal-preset snapshot asserts the exact assembled model-facing prompt. Composition checks cover the desktop overlay of the Web bundle, while focused config inspection pins the same instruction in every shipped persona.

## Alternatives considered

**Send the UI locale to the model.** This would force interface preference onto multilingual conversations and require new durable session state because model-visible inputs must be logged.

**Translate rendered model output in the client.** Post-processing can corrupt code, commands, paths, and quotations and cannot correct language choice during generation.

**Apply the rule only in the desktop bundle.** Desktop and Web would continue to diverge, and agent-scoped personas would shadow the desktop deployment persona.

## Consequences

Language following becomes the default for shipped personas without a settings or session-format change. Mixed-language messages still rely on the model's interpretation of the latest message, and providers may not follow the instruction perfectly.
