# claude-code-practice

A tiny sandbox for practicing the GitHub pull request workflow.

## What's here

`greet.py` has a single function, `greet(name)`, that returns a friendly
greeting string.

`docs/` holds **Spend Log**, an installable offline spending tracker built to log
a spend in under five seconds. See [`docs/README.md`](docs/README.md) for how to
publish it to GitHub Pages and add it to a phone's home screen.

## Running it

```bash
python greet.py          # the greeting sandbox
python -m http.server -d docs 8000   # the app, at http://localhost:8000
```

## Tests

```bash
python -m pytest         # greet.py
node --test "tests/**/*.test.js"     # Spend Log logic
```
