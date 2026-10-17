# Message formatting

Messages are stored exactly as typed. The browser turns the markup below into formatting when it shows a message, so the rules can change later without touching old messages. Everything is built as DOM nodes; no user text ever becomes HTML.

## Markdown

| Type | You see |
|---|---|
| `**bold**` | **bold** |
| `*italic*` or `_italic_` | *italic* |
| `__underline__` | underlined |
| `~~strike~~` | ~~strike~~ |
| `` `code` `` | inline code |
| ```` ```code block``` ```` (may span lines, optional language after the opening fence, no highlighting) | a code block |
| `\|\|spoiler\|\|` | hidden until clicked |
| `> quote` at the start of a line | a quote bar |
| `https://…` | a link that opens in a new tab |

A backslash shows a markup character as itself: `\*not italic\*`.

Nothing is formatted inside code, and mentions inside code stay as typed.

## Colours

`[cyan]text[/cyan]` colours the text. The palette is fixed so everything stays readable on the dark theme:

`red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`, `gray`

An unknown colour name, or a tag that isn't closed, stays as plain text.

## Effects

`[rainbow]text[/rainbow]` runs a rainbow gradient across the text, with a slow shimmer that stops for people who turn on "reduce motion".

## Combining

Formatting nests: `**[pink]bold pink[/pink]**`, `[rainbow]*italic rainbow*[/rainbow]`, `||[red]red spoiler[/red]||`. Mentions (`<@id>`) work inside any of them except code.
