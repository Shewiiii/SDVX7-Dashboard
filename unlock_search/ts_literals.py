from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

TOKEN = re.compile(
    r"\s+|//[^\n]*|/\*[\s\S]*?\*/|"
    r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|"
    r"-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|.",
)


class LiteralReader:
    def __init__(self, directory: Path) -> None:
        self.sources = {
            path.stem: path.read_text(encoding="utf-8")
            for path in directory.glob("*.ts")
        }
        self.cache: dict[str, Any] = {}

    def constant(self, name: str) -> Any:
        if name in self.cache:
            return self.cache[name]
        pattern = re.compile(r"\b(?:export\s+)?const\s+" + re.escape(name) + r"\s*=")
        matches = [
            (text, match.end())
            for text in self.sources.values()
            if (match := pattern.search(text))
        ]
        if len(matches) != 1:
            raise ValueError(f"Expected one data constant: {name}")
        text, start = matches[0]
        parser = LiteralParser(text[start:], self)
        value = parser.expression()
        if parser.peek() not in {";", "export", ""}:
            raise ValueError(f"Unsupported trailing expression in {name}")
        self.cache[name] = value
        return value


class LiteralParser:
    def __init__(self, text: str, reader: LiteralReader) -> None:
        self.tokens = [
            token
            for token in TOKEN.findall(text)
            if not token.isspace() and not token.startswith(("//", "/*"))
        ]
        self.index = 0
        self.reader = reader

    def peek(self) -> str:
        return self.tokens[self.index] if self.index < len(self.tokens) else ""

    def take(self, expected: str | None = None) -> str:
        token = self.peek()
        if not token or (expected is not None and token != expected):
            raise ValueError(f"Expected {expected!r}, got {token!r}")
        self.index += 1
        return token

    def expression(self) -> Any:
        token = self.take()
        if token == "[":
            value: Any = []
            while self.peek() != "]":
                value.append(self.expression())
                if self.peek() != ",":
                    break
                self.take(",")
            self.take("]")
        elif token == "{":
            value = {}
            while self.peek() != "}":
                key = self.take()
                if key.startswith(("'", '"')):
                    key = ast.literal_eval(key)
                self.take(":")
                if key in value:
                    raise ValueError(f"Duplicate object key: {key}")
                value[key] = self.expression()
                if self.peek() != ",":
                    break
                self.take(",")
            self.take("}")
        elif token.startswith(("'", '"')):
            value = ast.literal_eval(token)
        elif re.fullmatch(r"-?\d+(?:\.\d+)?", token):
            value = float(token) if "." in token else int(token)
        elif token in {"true", "false", "null"}:
            value = {"true": True, "false": False, "null": None}[token]
        elif re.fullmatch(r"[A-Za-z_$][\w$]*", token):
            value = self.reader.constant(token)
        else:
            raise ValueError(f"Unsupported token: {token!r}")

        while self.peek() in {"[", "."}:
            if self.peek() == "[":
                self.take("[")
                key = self.expression()
                self.take("]")
                value = value[key]
            else:
                self.take(".")
                method = self.take()
                self.take("(")
                argument = self.expression()
                self.take(")")
                if method == "concat" and isinstance(value, list):
                    value = value + argument
                elif method == "join" and isinstance(value, list):
                    value = argument.join(str(item) for item in value)
                else:
                    raise ValueError(f"Unsupported data method: {method}")
        return value
