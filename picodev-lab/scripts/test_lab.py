"""lab.py against a fake hub MCP: python3 -m unittest picodev-lab/scripts/test_lab.py"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

LAB = Path(__file__).with_name("lab.py")
CALLS = []
ANSWER = {"push_to_editor": (False, "Code envoyé au navigateur.")}
HEX = ":00000001FF\n"
SETUP = {"id": "setup-a", "board": {"kind": "arduino-nano", "fqbn": "arduino:avr:nano"}, "libraries": ["Servo@1.2.2"]}
# A stand-in for arduino-cli (PICODEV_ARDUINO_CLI): FAKE_CLI is ok, error (the code's), nocore (install fails too)
# or nolib (a header missing until lib install); each call is a line of FAKE_CLI_LOG.
FAKE_CLI = f"""#!{sys.executable}
import os, sys, pathlib
log = pathlib.Path(os.environ["FAKE_CLI_LOG"])
mode = os.environ["FAKE_CLI"]
with log.open("a") as f:
    f.write(" ".join(sys.argv[1:]) + "\\n")
calls = log.read_text()
if sys.argv[1] == "compile":
    src = pathlib.Path(sys.argv[-1]); out = pathlib.Path(sys.argv[sys.argv.index("--output-dir") + 1])
    if mode == "error":
        sys.exit(print(f"{{src}}/{{src.name}}.ino:1:1: error: 'foo' was not declared in this scope", file=sys.stderr) or 1)
    if mode == "nocore":
        sys.exit(print("Error during build: Platform 'arduino:avr' not found: platform not installed", file=sys.stderr) or 1)
    if mode == "nolib" and "lib install" not in calls:
        sys.exit(print(f"{{src}}/{{src.name}}.ino:1:10: fatal error: Servo.h: No such file or directory", file=sys.stderr) or 1)
    out.mkdir(parents=True, exist_ok=True)
    (out / (src.name + ".ino.hex")).write_text({HEX!r})
    (out / (src.name + ".ino.with_bootloader.hex")).write_text("bootloader")
    sys.exit(0)
sys.exit(1 if mode == "nocore" else 0)
"""


class Hub(BaseHTTPRequestHandler):
    def do_POST(self):
        msg = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        tool, args = msg["params"]["name"], msg["params"]["arguments"]
        CALLS.append((tool, args))
        is_error, text, *code = ANSWER.get(tool, (False, "{}"))  # a third item: the error code in _meta (contract 0.20)
        result = {"content": [{"type": "text", "text": text}], "isError": is_error}
        if code:
            result["_meta"] = {"lab.picodev.fr/error": code[0]}
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": result})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


class LabTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hub = HTTPServer(("127.0.0.1", 0), Hub)
        threading.Thread(target=cls.hub.serve_forever, daemon=True).start()
        cls.origin = f"http://127.0.0.1:{cls.hub.server_port}"

    def setUp(self):
        CALLS.clear()
        self.tmp = Path(tempfile.mkdtemp())
        self.data, self.proj = self.tmp / "data", self.tmp / "proj"
        (self.proj / "sketch").mkdir(parents=True)
        (self.proj / "sketch" / "sketch.ino").write_text("void setup(){}\nvoid loop(){}\n")
        self.env = {**os.environ, "CLAUDE_PLUGIN_DATA": str(self.data), "CLAUDE_PROJECT_DIR": str(self.proj)}
        self.env.pop("PICODEV_LAB_HUB", None)
        self.env["PICODEV_ARDUINO_CLI"] = str(self.tmp / "no-arduino-cli")  # absent unless a test makes it
        ANSWER["read_setup"] = (False, json.dumps(SETUP))

    def cli(self, mode):
        path = self.tmp / "arduino-cli"
        path.write_text(FAKE_CLI)
        path.chmod(0o755)
        self.env.update(PICODEV_ARDUINO_CLI=str(path), FAKE_CLI=mode, FAKE_CLI_LOG=str(self.tmp / "cli.log"))

    def cli_calls(self):
        log = self.tmp / "cli.log"
        return log.read_text().splitlines() if log.exists() else []

    def pushed(self):
        return [c[0] for c in CALLS if c[0] in ("push_program", "push_to_editor")]

    def lab(self, *args, stdin=""):
        return subprocess.run([sys.executable, str(LAB), *args], input=stdin, capture_output=True, text=True, env=self.env)

    def save(self):
        s = {"session": "abc", "agent_token": "secret-token", "open_url": f"{self.origin}/bench/setup-a/challenge?s=abc#o=x",
             "setup": "setup-a", "mode": "challenge"}
        self.assertEqual(self.lab("save", stdin=json.dumps(s)).returncode, 0)

    def hook(self, path):
        out = self.lab("hook-push", stdin=json.dumps({"tool_name": "Edit", "tool_input": {"file_path": str(path)}})).stdout
        return json.loads(out) if out.strip() else None

    def test_session_file_is_private_and_outside_the_project(self):
        self.save()
        files = list((self.data / "sessions").iterdir())
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        self.assertNotIn("secret-token", "".join(p.read_text() for p in self.proj.rglob("*") if p.is_file()))
        self.assertIn("secret-token", self.lab("show").stdout)
        self.lab("clear")
        self.assertNotEqual(self.lab("show").returncode, 0)

    def test_hook_pushes_the_sketch_folder(self):
        self.save()
        (self.proj / "sketch" / "util.h").write_text("#pragma once\n")
        out = self.hook(self.proj / "sketch" / "util.h")
        self.assertIn("compilé par le labo (arduino-cli absent)", out["systemMessage"])
        tool, args = CALLS[-1]
        self.assertEqual(tool, "push_to_editor")
        self.assertEqual([f["name"] for f in args["files"]], ["sketch.ino", "util.h"])
        self.assertTrue(args["run"])

    def test_hook_is_quiet_without_session_or_for_other_files(self):
        self.assertIsNone(self.hook(self.proj / "sketch" / "sketch.ino"))
        self.save()
        self.assertIsNone(self.hook(self.proj / "README.md"))
        (self.proj / "lib").mkdir()
        (self.proj / "lib" / "util.cpp").write_text("")
        self.assertIsNone(self.hook(self.proj / "lib" / "util.cpp"))  # a source but no sketch: quiet
        self.lab("autopush", "off")
        self.assertIsNone(self.hook(self.proj / "sketch" / "sketch.ino"))
        self.assertEqual(CALLS, [])

    def test_limits_send_nothing(self):
        self.save()
        for i in range(8):
            (self.proj / "sketch" / f"f{i}.h").write_text("")
        out = self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertIn("rien n'est envoyé", out["systemMessage"])
        for i in range(8):
            (self.proj / "sketch" / f"f{i}.h").unlink()
        (self.proj / "sketch" / "big.h").write_text("x" * 70_000)
        self.assertIn("64 au plus", self.hook(self.proj / "sketch" / "sketch.ino")["systemMessage"])
        self.assertEqual(CALLS, [])

    def test_no_browser_and_ended_session(self):
        # the hub's texts, French then English (hub v0.4.1): both are understood
        for no_browser, gone in (
            ("Aucun navigateur n'est connecté à cette session : ouvrez open_url dans un navigateur.",
             "Session inconnue ou terminée : ouvrez-en une autre avec open_session."),
            ("No browser is connected to this session: open open_url in a browser.",
             "Unknown or ended session: open another one with open_session."),
        ):
            self.save()
            ANSWER["push_to_editor"] = (True, "Error executing tool push_to_editor: " + no_browser)
            out = self.hook(self.proj / "sketch" / "sketch.ino")
            self.assertIn("aucun navigateur connecté", out["systemMessage"])
            self.assertIn("open_url", out["hookSpecificOutput"]["additionalContext"])
            ANSWER["push_to_editor"] = (True, "Error executing tool push_to_editor: " + gone)
            self.assertIn("terminée", self.hook(self.proj / "sketch" / "sketch.ino")["systemMessage"])
            self.assertNotEqual(self.lab("show").returncode, 0)  # the file is gone
        ANSWER["push_to_editor"] = (False, "Code envoyé au navigateur.")

    def test_error_code_before_text(self):
        # contract 0.20: the code in _meta decides, whatever the text; an unknown code is an ordinary error
        self.save()
        ANSWER["push_to_editor"] = (True, "Il manque quelque chose.", "no_browser")
        self.assertIn("aucun navigateur connecté", self.hook(self.proj / "sketch" / "sketch.ino")["systemMessage"])
        ANSWER["push_to_editor"] = (True, "Session inconnue, navigateur absent.", "later_code")
        out = self.hook(self.proj / "sketch" / "sketch.ino")["systemMessage"]
        self.assertIn("poussée impossible", out)
        self.assertEqual(self.lab("show").returncode, 0)  # not gone: the session is kept
        ANSWER["push_to_editor"] = (True, "Autre chose.", "gone")
        self.assertIn("terminée", self.hook(self.proj / "sketch" / "sketch.ino")["systemMessage"])
        self.assertNotEqual(self.lab("show").returncode, 0)
        ANSWER["push_to_editor"] = (False, "Code envoyé au navigateur.")

    def test_compiled_here_is_push_program(self):
        self.save()
        self.cli("ok")
        out = self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertIn("compilé sur votre poste", out["systemMessage"])
        tool, args = CALLS[-1]
        self.assertEqual(tool, "push_program")
        self.assertEqual((args["hex"], args["run"], [f["name"] for f in args["files"]]), (HEX, True, ["sketch.ino"]))
        self.assertIn("compile --fqbn arduino:avr:nano --output-dir", self.cli_calls()[0])
        # the board is asked once a session, then kept in the session file
        self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertEqual([c[0] for c in CALLS].count("read_setup"), 1)
        last = json.loads(self.lab("show").stdout)["last_push"]
        self.assertEqual((last["ok"], last["path"]), (True, "agent"))

    def test_code_error_is_not_a_fallback(self):
        self.save()
        self.cli("error")
        out = self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertIn("ne compile pas", out["systemMessage"])
        note = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("'foo' was not declared", note)
        self.assertIn(str(self.proj / "sketch" / "sketch.ino"), note)  # the visitor's path, not the temporary one
        self.assertEqual(self.pushed(), [])
        self.assertIn("'foo'", json.loads(self.lab("show").stdout)["last_push"]["log"])

    def test_missing_core_falls_back_to_the_lab(self):
        self.save()
        self.cli("nocore")
        out = self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertIn("compilé par le labo", out["systemMessage"])
        self.assertEqual(self.pushed(), ["push_to_editor"])
        self.assertIn("core install arduino:avr", self.cli_calls())
        self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertEqual(self.cli_calls().count("core install arduino:avr"), 1)  # tried once a session

    def test_missing_library_is_installed_once(self):
        self.save()
        self.cli("nolib")
        self.hook(self.proj / "sketch" / "sketch.ino")
        self.assertIn("lib install Servo@1.2.2", self.cli_calls())
        self.assertEqual(self.pushed(), ["push_program"])

    def test_a_lab_without_push_program_compiles_itself(self):
        self.save()
        self.cli("ok")
        ANSWER["push_program"] = (True, "Unknown tool: push_program")
        out = self.hook(self.proj / "sketch" / "sketch.ino")
        del ANSWER["push_program"]
        self.assertIn("compilé par le labo", out["systemMessage"])
        self.assertEqual(self.pushed(), ["push_program", "push_to_editor"])

    def test_missing_sketch_folder_is_said(self):
        self.save()
        out = self.lab("push", str(self.proj / "nope"))
        self.assertEqual(out.returncode, 1)
        self.assertIn("pas de dossier", out.stdout)
        self.assertNotIn("Traceback", out.stderr)

    def test_git_opt_in_commits_each_push(self):
        self.save()
        sketch = self.proj / "sketch"
        self.assertFalse(json.loads(self.lab("git", "status", str(sketch)).stdout)["in_repo"])
        self.assertEqual(self.lab("git", "init", str(sketch)).returncode, 0)
        self.assertIn("*.hex", (sketch / ".gitignore").read_text())
        self.cli("ok")
        self.hook(sketch / "sketch.ino")
        log = subprocess.run(["git", "-C", str(sketch), "log", "--format=%s"], capture_output=True, text=True).stdout
        self.assertRegex(log, r"^push \d\d:\d\d \(compilé sur votre poste\)")
        self.assertEqual(subprocess.run(["git", "-C", str(sketch), "remote"], capture_output=True, text=True).stdout, "")

    def test_brief_preview_is_spec_draft(self):
        (self.proj / "spec-projet.md").write_text(
            "# Capteur d'air\n\n## Contexte du projet\nUne PME.\n\n## Fonction principale\nMesure le CO2.\n\n## Alimentation\nÀ préciser\n")
        self.env["PICODEV_LAB_HUB"] = self.origin
        sections = [{"id": "envelope", "state": "filled"}, {"id": "fonctionPrincipale", "state": "thin"}, {"id": "alimentation", "state": "empty"}]
        ANSWER["spec_draft"] = (False, json.dumps({"rules": [], "sections": sections, "next": "fonctionPrincipale", "ready": False,
                                                   "filename": "x.pdf", "pdf": "JVBERg=="}))
        out = self.lab("brief", str(self.proj / "spec-projet.md"), "--lang", "en")
        self.assertEqual(out.returncode, 0, out.stderr)
        tool, args = CALLS[-1]
        self.assertEqual(tool, "spec_draft")
        self.assertEqual(args, {"title": "Capteur d'air", "sections": {"envelope": "Une PME.", "fonctionPrincipale": "Mesure le CO2."},
                                "language": "en", "pdf": True})
        self.assertEqual((self.proj / "spec-projet.pdf").read_bytes(), b"%PDF")
        res = json.loads(out.stdout)
        self.assertEqual((res["missing"], res["next"], res["sent"]), (["fonctionPrincipale", "alimentation"], "fonctionPrincipale", False))
        self.assertNotIn("JVBERg", out.stdout)

    def test_brief_send_is_brief_submit(self):
        (self.proj / "spec-projet.md").write_text("# Capteur d'air\n\n## Contexte du projet\nUne PME.\n")
        self.env["PICODEV_LAB_HUB"] = self.origin
        ANSWER["brief_submit"] = (False, json.dumps({"sent": True, "filename": "x.pdf", "pdf": "JVBERg==", "missing": [], "next": "ok"}))
        spec = str(self.proj / "spec-projet.md")
        self.assertNotEqual(self.lab("brief", spec, "--send", "--consent").returncode, 0)  # no contact: nothing sent
        self.assertEqual(CALLS, [])
        out = self.lab("brief", spec, "--send", "--consent", "--name", "Ana", "--email", "ana@example.com")
        self.assertEqual(out.returncode, 0, out.stderr)
        tool, args = CALLS[-1]
        self.assertEqual(tool, "brief_submit")
        self.assertEqual((args["send"], args["consent"], args["language"]), (True, True, "fr"))
        self.assertEqual(args["contact"], {"name": "Ana", "email": "ana@example.com"})

    def test_brief_figures_contact_and_language(self):
        figs = self.proj / "spec-figures"
        figs.mkdir()
        (figs / "usage.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
        (figs / "forme.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
        (self.proj / "spec-projet.md").write_text(
            "# Capteur d'air\n\n## Contexte du projet\nUne PME.\n![Mise en situation](spec-figures/usage.png)\n\n"
            "## Format et encombrement\n![Forme proposée](spec-figures/forme.svg)\n\n## Coordonnées\nAna, ana@example.com\n")
        self.env["PICODEV_LAB_HUB"] = self.origin
        ANSWER["spec_draft"] = (False, json.dumps({"rules": [], "sections": [], "next": None, "ready": False, "filename": "x.pdf", "pdf": "JVBERg=="}))
        out = self.lab("brief", str(self.proj / "spec-projet.md"))
        self.assertEqual(out.returncode, 0, out.stderr)
        _, args = CALLS[-1]
        self.assertEqual(args["language"], "fr")  # French headings, no --lang
        self.assertEqual(args["sections"], {"envelope": "Une PME.", "contact": "Ana, ana@example.com"})  # figure lines taken out
        self.assertEqual([(f["section"], f["caption"], f["type"]) for f in args["figures"]],
                         [("envelope", "Mise en situation", "png"), ("format", "Forme proposée", "svg")])
        self.assertEqual(base64.b64decode(args["figures"][0]["data"]), b"\x89PNG\r\n\x1a\nfake")
        self.assertTrue(json.loads(out.stdout)["contact_in_pdf"])
        # English headings: English
        (self.proj / "spec-projet.md").write_text("# Air\n\n## Project context\nA firm.\n\n## Main function\nCO2.\n")
        self.lab("brief", str(self.proj / "spec-projet.md"))
        self.assertEqual(CALLS[-1][1]["language"], "en")
        # a figure outside the spec's folder is refused, nothing is sent
        CALLS.clear()
        (self.proj / "spec-projet.md").write_text("# Air\n\n## Contexte du projet\n![x](../secret.png)\n")
        out = self.lab("brief", str(self.proj / "spec-projet.md"))
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("hors du dossier", out.stderr)
        self.assertEqual(CALLS, [])

    def test_workspace_creates_then_keeps(self):
        d = self.proj / "mon-projet"
        out = self.lab("workspace", str(d))
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("## Fonction principale", (d / "spec-projet.md").read_text())
        self.assertTrue((d / "spec-figures").is_dir())
        self.assertEqual(sorted(p.name for p in d.iterdir()), ["spec-figures", "spec-projet.md"])  # nothing else, no settings
        (d / "spec-projet.md").write_text("# Mien\n")
        out = self.lab("workspace", str(d))  # idempotent, the visitor's file kept
        self.assertEqual(json.loads(out.stdout)["created"], [])
        self.assertEqual((d / "spec-projet.md").read_text(), "# Mien\n")
        self.assertIn("## Main function", self.lab("workspace", str(self.proj / "en"), "--lang", "en") and (self.proj / "en" / "spec-projet.md").read_text())


class ReleaseTest(unittest.TestCase):
    def test_server_json_follows_plugin_version(self):
        root = LAB.parents[2]
        plugin = json.loads((root / "picodev-lab/.claude-plugin/plugin.json").read_text())
        server = json.loads((root / "server.json").read_text())
        self.assertEqual(server["version"], plugin["version"])
        self.assertEqual(server["remotes"], [{"type": "streamable-http", "url": "https://lab.picodev.fr/mcp"}])


if __name__ == "__main__":
    unittest.main()
