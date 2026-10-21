#!/usr/bin/env python3
"""Picodev Lab plugin helper: the session file, the write hook, the update check, the project spec.

Standard library only. Talks to the hub's public MCP and nothing else. The session's agent token is
kept in the plugin's data directory (mode 600), never in the visitor's project, and never printed
except by `show`, which the skills use to pick a session up again.

    lab.py save          stdin: the open_session result plus setup and mode
    lab.py show | clear  the project's session file
    lab.py push [file]   the sketch's folder to the browser: compiled here (arduino-cli, push_program),
                         or by the lab when the toolchain is missing (push_to_editor); run=true
    lab.py hook-push     PostToolUse hook: stdin is the hook's JSON
    lab.py git status|init|off [folder]   the local git repository of the sketch (a commit a push)
    lab.py autopush on|off
    lab.py update-check  SessionStart hook: newest v* tag of the plugin, once a day
    lab.py workspace DIR [--lang fr|en]                               the spec's folder: the skeleton and spec-figures/, nothing overwritten
    lab.py brief SPEC.md [--lang fr|en]                               preview: spec_draft(pdf=true), with its figures
    lab.py brief SPEC.md --send --consent [--nda] --name N --email E ...   brief_submit
"""

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

HUB = "https://lab.picodev.fr"
REPO = "https://github.com/PICODEV-SAS/picodev-lab-plugin"
SOURCES = {".ino", ".h", ".hpp", ".c", ".cpp"}
MAX_FILES, MAX_BYTES = 8, 64 * 1024  # hub limits (architecture, "Hub > Limites")
MAX_HEX = 48 * 1024  # push_program's hex (architecture, "Binaire d'abord")
COMPILE_BUDGET = 90  # s for arduino-cli (compiles and installs) in a push; hooks.json gives the hook 120
INSTALL_TIMEOUT = 60  # s for one core or library install
# ponytail: arduino-cli's own texts (1.x, English); a toolchain gap told apart from a code error by them
CORE_MISSING = re.compile(r"platform not installed|platform '[^']*' not found|unknown package|invalid fqbn", re.I)
HEADER_MISSING = re.compile(r"([\w./-]+\.h)\s*: No such file or directory")
GITIGNORE = "# build outputs (arduino-cli, Arduino IDE)\nbuild/\n*.hex\n*.elf\n*.bin\n*.eep\n*.map\n"
NAME_RE = re.compile(r"^[\w.-]{1,64}$")  # what the editor accepts as a file name
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
DAY = 24 * 3600
# The 8 headings of the MAS brief, with the ids brief_submit takes (architecture, "Vers Picodev")
SECTIONS = [
    ("envelope", "Contexte du projet"),
    ("fonctionPrincipale", "Fonction principale"),
    ("fonctions", "Modules et fonctions"),
    ("alimentation", "Alimentation"),
    ("format", "Format et encombrement"),
    ("environnement", "Environnement"),
    ("production", "Production"),
    ("preferences", "Préférences techniques"),
]
# The same headings in English (spec_draft's HEADINGS_EN): a spec written in English is read too
SECTIONS_EN = [
    ("envelope", "Project context"),
    ("fonctionPrincipale", "Main function"),
    ("fonctions", "Modules and functions"),
    ("alimentation", "Power supply"),
    ("format", "Form factor and dimensions"),
    ("environnement", "Environment"),
    ("production", "Production"),
    ("preferences", "Technical preferences"),
]
CONTACT_HEADS = ("coordonnees", "contact")  # `## Coordonnées`, `## Contact`, `## Contact details`: sections.contact (v0.16)
FIGURE_RE = re.compile(r"^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$")  # ![caption](spec-figures/x.png), alone on its line
MAX_FIGURES, MAX_FIGURE, MAX_FIGURES_ALL, MAX_CAPTION = 3, 200 * 1024, 400 * 1024, 120  # architecture 0.16


class HubError(Exception):
    pass


# ── where things are ──

def data_dir(arg=None):
    d = arg or os.environ.get("CLAUDE_PLUGIN_DATA") or str(Path.home() / ".claude" / "picodev-lab")
    return Path(d)


def project_dir(arg=None):
    return arg or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def project_key(path):
    # same rule as hooks/lab.ts: every character but a letter or digit becomes '-'
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def session_file(a):
    return data_dir(a.data) / "sessions" / (project_key(project_dir(a.project)) + ".json")


def write_private(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.chmod(path, 0o600)  # a file made before keeps its old mode otherwise


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def load_session(a):
    s = read_json(session_file(a))
    return s if isinstance(s, dict) and s.get("session") and s.get("agent_token") else None


def origin(url):
    m = re.match(r"^(https?://[^/?#]+)", url or "")
    return m.group(1) if m else None


def hub_of(s):
    return os.environ.get("PICODEV_LAB_HUB") or (s and origin(s.get("open_url"))) or HUB


# ── the MCP, over plain HTTP (streamable transport, stateless) ──

def mcp(hub, tool, args, timeout=15):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    req = urllib.request.Request(
        hub.rstrip("/") + "/mcp",
        data=body.encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            ctype = r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raise HubError(f"le labo répond {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise HubError(f"labo injoignable ({getattr(e, 'reason', e)})")
    if "text/event-stream" in ctype:  # one JSON-RPC answer in the last data: line
        raw = [line[5:].strip() for line in raw.splitlines() if line.startswith("data:")][-1]
    msg = json.loads(raw)
    if "error" in msg:
        raise HubError(msg["error"].get("message", "erreur du MCP"))
    res = msg["result"]
    texts = [c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"]
    if res.get("isError"):
        raise HubError(re.sub(r"^Error executing tool \w+: ", "", "".join(texts)))
    sc = res.get("structuredContent")
    if isinstance(sc, dict):  # a list or a string comes wrapped as {"result": ...}
        return sc["result"] if set(sc) == {"result"} else sc
    values = []
    for t in texts:  # without it, a list comes one content block per item
        try:
            values.append(json.loads(t))
        except ValueError:
            values.append(t)
    return values[0] if len(values) == 1 else values


def is_gone(err):
    # ponytail: the hub has no error code; its text is French then English (hub v0.4.1), both accepted
    return bool(re.search(r"inconnue|unknown", str(err), re.I))


# ── session file ──

def cmd_save(a):
    try:
        s = json.load(sys.stdin)
    except ValueError:
        s = None
    if not (isinstance(s, dict) and SESSION_RE.match(str(s.get("session", ""))) and s.get("agent_token")
            and origin(s.get("open_url")) and s.get("setup") and s.get("mode") in ("free", "challenge")):
        sys.exit("lab: il faut {session, agent_token, open_url, setup, mode} tels que rendus par open_session")
    keep = {k: s[k] for k in ("session", "agent_token", "open_url", "setup", "mode")}
    keep["opened_at"] = int(time.time())
    write_private(session_file(a), keep)
    print(f"Session {keep['session']} enregistrée hors du projet ({session_file(a)}).")


def cmd_show(a):
    s = load_session(a)
    if not s:
        sys.exit("lab: aucune session ouverte pour ce projet")
    print(json.dumps(s, ensure_ascii=False, indent=2))


def cmd_clear(a):
    session_file(a).unlink(missing_ok=True)
    print("Session oubliée.")


def cmd_autopush(a):
    path = data_dir(a.data) / "settings.json"
    st = read_json(path) or {}
    st["autopush"] = a.state == "on"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(st), encoding="utf-8")
    print(f"auto-push {a.state}")


def autopush_on(a):
    return (read_json(data_dir(a.data) / "settings.json") or {}).get("autopush", True) is not False


# ── push ──

def sketch_files(folder):
    """The sketch's sources in `folder` (not below), the .ino first; or a reason not to send them."""
    if not Path(folder).is_dir():
        return None, f"pas de dossier {folder} : écrivez d'abord le sketch (le sketch de départ du banc, par exemple)"
    paths = sorted((p for p in Path(folder).iterdir() if p.is_file() and p.suffix.lower() in SOURCES),
                   key=lambda p: (p.suffix.lower() != ".ino", p.name))
    if not any(p.suffix.lower() == ".ino" for p in paths):
        return None, f"pas de .ino dans {folder} : ce n'est pas un sketch, rien n'est envoyé"
    if len(paths) > MAX_FILES:
        return None, f"{len(paths)} fichiers dans {folder}, le labo en prend {MAX_FILES} au plus : rien n'est envoyé"
    bad = [p.name for p in paths if not NAME_RE.match(p.name)]
    if bad:
        return None, f"nom de fichier refusé par le banc ({', '.join(bad)}) : lettres, chiffres, . _ - seulement"
    files = [{"name": p.name, "content": p.read_text(encoding="utf-8", errors="replace")} for p in paths]
    size = sum(len(f["content"].encode()) for f in files)
    if size > MAX_BYTES:
        return None, f"le sketch fait {size // 1024} Kio, le labo en prend 64 au plus : rien n'est envoyé"
    return files, None


# ── compile on the visitor's machine (architecture, "Binaire d'abord") ──

def find_cli():
    p = os.environ.get("PICODEV_ARDUINO_CLI") or shutil.which("arduino-cli")
    return p if p and os.access(p, os.X_OK) else None


def board(s):
    """The setup's board and libraries (read_setup), kept in the session file; None when the lab does not say."""
    b = s.get("board")
    if isinstance(b, dict) and b.get("fqbn"):
        return b
    try:
        v = mcp(hub_of(s), "read_setup", {"id": s["setup"]})
        b = {"fqbn": str(v["board"]["fqbn"]), "libraries": [x for x in v.get("libraries") or [] if isinstance(x, str)]}
    except (HubError, KeyError, TypeError, AttributeError):
        return None
    s["board"] = b
    return b


def run_cli(argv, timeout):
    try:
        # English whatever the visitor's locale: the messages are matched (CORE_MISSING, HEADER_MISSING)
        env = {**os.environ, "LC_ALL": "C", "LANG": "C", "ARDUINO_LOCALE": "en", "NO_COLOR": "1"}
        r = subprocess.run(argv, capture_output=True, text=True, timeout=max(1, timeout), stdin=subprocess.DEVNULL, env=env)
        return r.returncode, re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr).strip()  # colours, if any are left
    except subprocess.TimeoutExpired:
        return None, f"arduino-cli : plus de {int(timeout)} s"
    except OSError as e:
        return None, f"arduino-cli : {e}"


def compile_here(s, files, folder, deadline):
    """("agent", hex), ("error", log) for a code error, or ("cloud", why) when the toolchain is missing."""
    cli = find_cli()
    if not cli:
        return "cloud", "arduino-cli absent"
    b = board(s)
    if not b:
        return "cloud", "carte du montage inconnue"
    stem = files[0]["name"].rsplit(".", 1)[0]
    with tempfile.TemporaryDirectory(prefix="picodev-lab-") as tmp:
        # the folder named as its .ino, as arduino-cli wants; only the files the lab would get
        src, out = Path(tmp) / stem, Path(tmp) / "out"
        src.mkdir()
        for f in files:
            (src / f["name"]).write_text(f["content"], encoding="utf-8")
        done = s.setdefault("installed", {})  # one install try a session: {"core": ok, "libs": ok}
        while True:
            left = deadline - time.monotonic()
            if left < 3:
                return "cloud", "compilation trop longue"
            code, log = run_cli([cli, "compile", "--fqbn", b["fqbn"], "--output-dir", str(out), str(src)], left)
            if code is None:
                return "cloud", log
            if code == 0:
                hexes = [p for p in (out / f"{stem}.ino.hex", *sorted(out.glob("*.hex"))) if p.is_file() and "bootloader" not in p.name]
                return ("agent", hexes[0].read_text()) if hexes else ("cloud", "arduino-cli n'a pas rendu de HEX")
            log = log.replace(str(src), str(folder))
            need = "core" if CORE_MISSING.search(log) else "libs" if HEADER_MISSING.search(log) and b["libraries"] else None
            if not need:
                return "error", log
            what = ":".join(b["fqbn"].split(":")[:2]) if need == "core" else " ".join(b["libraries"])
            if need not in done:
                cmd = ["core", "install", what] if need == "core" else ["lib", "install", *b["libraries"]]
                done[need] = run_cli([cli, *cmd], min(INSTALL_TIMEOUT, deadline - time.monotonic()))[0] == 0
                if done[need]:
                    continue
            if need == "libs" and done[need]:
                return "error", log  # the libraries are there: the include is the code's
            return "cloud", f"{'cœur' if need == 'core' else 'bibliothèque'} {what} absent ({'core' if need == 'core' else 'lib'} install {what})"


def clip(log, lines=40, chars=4000):
    return "\n".join(log.splitlines()[-lines:])[-chars:]


# ── push ──

def push(a, s, folder):
    """{ok, msg (for the person), note (for Claude), path ("agent" | "cloud"), log?}."""
    files, why = sketch_files(folder)
    if why:
        return {"ok": False, "msg": why, "note": why}
    names = ", ".join(f["name"] for f in files)
    path, out = compile_here(s, files, folder, time.monotonic() + COMPILE_BUDGET)
    fqbn = (s.get("board") or {}).get("fqbn", "?")
    if path == "error":
        log = clip(out)
        return {"ok": False, "path": "agent", "log": log,
                "msg": "le sketch ne compile pas (compilé sur votre poste) : rien n'est envoyé, Claude corrige",
                "note": (f"le sketch ne compile pas sur le poste du visiteur (arduino-cli, {fqbn}) : rien n'est envoyé au banc "
                         f"(le labo échouerait de même). Corrigez ces erreurs, le hook repoussera :\n{log}")}
    if path == "agent" and len(out.encode()) > MAX_HEX:
        path, out = "cloud", f"programme de {len(out.encode()) // 1024} Kio, push_program en prend 48 au plus"
    args = {"session": s["session"], "agent_token": s["agent_token"], "files": files, "run": True}
    try:
        if path == "agent":
            try:
                mcp(hub_of(s), "push_program", {**args, "hex": out}, timeout=30)
            except HubError as e:
                if "push_program" not in str(e):  # an unknown tool names itself; the session's errors do not
                    raise
                path, out = "cloud", "le labo ne prend pas encore de programme"
        if path == "cloud":
            mcp(hub_of(s), "push_to_editor", args)
    except HubError as e:
        if is_gone(e):
            session_file(a).unlink(missing_ok=True)
            msg = "la session du labo est terminée : ouvrez-en une autre avec /lab"
        elif re.search(r"navigateur|browser", str(e), re.I):
            msg = "aucun navigateur connecté : ouvrez le banc (open_url) pour que le code y soit poussé"
        else:
            msg = f"poussée impossible : {e}"
        return {"ok": False, "path": path, "msg": msg, "note": msg if is_gone(e) else f"{msg}. open_url : {s.get('open_url', '?')}"}
    if path == "agent":
        return {"ok": True, "path": path, "msg": f"compilé sur votre poste, programme envoyé au banc ({names})",
                "note": (f"{names} compilé sur le poste du visiteur (arduino-cli, {fqbn}), programme envoyé au banc "
                         f"(push_program) et lancé. Lisez le résultat avec read_simulation.")}
    return {"ok": True, "path": path, "msg": f"poussé dans le banc ({names}), compilé par le labo ({out})",
            "note": (f"{names} poussé dans le banc, compilé par le labo, pas sur le poste ({out}). "
                     f"Lisez le résultat avec read_simulation (compile.log).")}


def in_repo(folder):
    try:
        return subprocess.run(["git", "-C", str(folder), "rev-parse", "--is-inside-work-tree"],
                              capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


def commit(folder, path):
    """A commit of the sketch's folder after a push the visitor opted into (lab.py git init). Never pushed."""
    where = "compilé sur votre poste" if path == "agent" else "compilé par le labo"
    git = ["git", "-C", str(folder)]
    try:
        who = subprocess.run([*git, "config", "user.email"], capture_output=True, text=True, timeout=5).stdout.strip()
        ident = [] if who else ["-c", "user.name=Picodev Lab", "-c", "user.email=picodev-lab@localhost"]
        subprocess.run([*git, "add", "-A", "--", "."], capture_output=True, timeout=10)
        subprocess.run([*git, *ident, "commit", "-q", "-m", f"push {time.strftime('%H:%M')} ({where})", "--", "."],
                       capture_output=True, timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        pass  # nothing to commit, no git: the push went all the same


def record(a, s, folder, r):
    last = {"at": int(time.time()), "ok": r["ok"], "message": r["msg"]}
    last.update({k: r[k] for k in ("path", "log") if r.get(k)})
    s.update(sketch_dir=str(folder), last_push=last, in_repo=in_repo(folder) if Path(folder).is_dir() else None)
    if r["ok"] and s.get("git"):
        commit(folder, r.get("path"))
    if session_file(a).exists():
        write_private(session_file(a), s)


def cmd_push(a):
    s = load_session(a)
    if not s:
        sys.exit("lab: aucune session ouverte pour ce projet (/lab pour en ouvrir une)")
    folder = Path(a.file).parent if a.file and Path(a.file).is_file() else Path(a.file or s.get("sketch_dir") or project_dir(a.project))
    r = push(a, s, folder)
    record(a, s, folder, r)
    print(r["msg"] + (f"\n{r['log']}" if r.get("log") else ""))
    sys.exit(0 if r["ok"] else 1)


def cmd_hook_push(a):
    try:
        e = json.load(sys.stdin)
    except ValueError:
        return
    path = (e.get("tool_input") or {}).get("file_path") or ""
    if Path(path).suffix.lower() not in SOURCES:
        return
    folder = Path(path).parent
    if not (folder.is_dir() and any(p.suffix.lower() == ".ino" for p in folder.iterdir())):
        return  # a source that is not a sketch's: nothing to say
    if not a.project and not os.environ.get("CLAUDE_PROJECT_DIR"):
        a.project = e.get("cwd")
    s = load_session(a)
    if not s or not autopush_on(a):
        return
    r = push(a, s, folder)
    record(a, s, folder, r)
    print(json.dumps({
        "systemMessage": f"picodev-lab : {r['msg']}",
        "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": f"picodev-lab : {r['note']}"},
    }, ensure_ascii=False))


def cmd_git(a):
    s = load_session(a)
    if not s:
        sys.exit("lab: aucune session ouverte pour ce projet (/lab pour en ouvrir une)")
    folder = Path(a.folder or s.get("sketch_dir") or Path(project_dir(a.project)) / "sketch")
    repo = in_repo(folder) if folder.is_dir() else False
    if a.state == "status":
        print(json.dumps({"folder": str(folder), "exists": folder.is_dir(), "in_repo": repo, "commits": bool(s.get("git"))}, ensure_ascii=False))
        return
    if a.state == "off":
        s["git"] = False
        print("Plus de commit après les envois (le dépôt reste).")
    else:
        if not folder.is_dir():
            sys.exit(f"lab: pas de dossier {folder} : écrivez d'abord le sketch")
        if repo and not s.get("git"):
            sys.exit(f"lab: {folder} est déjà dans un dépôt git : le plugin n'y commite pas")
        if not repo:
            r = subprocess.run(["git", "init", "-q", str(folder)], capture_output=True, text=True, timeout=10)
            if r.returncode:
                sys.exit(f"lab: git init a échoué : {r.stderr.strip()}")
            gi = folder / ".gitignore"
            if not gi.exists():
                gi.write_text(GITIGNORE, encoding="utf-8")
        s.update(git=True, in_repo=True, sketch_dir=str(folder))
        print(f"Dépôt git local dans {folder} : un commit après chaque envoi réussi, rien n'est envoyé à un hébergeur.")
    write_private(session_file(a), s)


# ── update notice ──

def version_tuple(v):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", v.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def latest_tag():
    try:
        out = subprocess.run(["git", "ls-remote", "--tags", "--refs", REPO], capture_output=True, text=True,
                             timeout=5, env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "true"}).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    tags = [t for t in (version_tuple(l.rsplit("refs/tags/", 1)[-1]) for l in out.splitlines() if "refs/tags/v" in l) if t]
    return ".".join(map(str, max(tags))) if tags else None


def cmd_update_check(a):
    current = (read_json(Path(__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json") or {}).get("version", "0.0.0")
    path = data_dir(a.data) / "update.json"
    seen = read_json(path) or {}
    if time.time() - seen.get("checked_at", 0) > DAY:
        latest = latest_tag()  # no network, or the repository out of reach: nothing is said (P6.4)
        seen = {"checked_at": int(time.time()), "latest": latest or seen.get("latest")}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(seen), encoding="utf-8")
    latest = seen.get("latest")
    if latest and version_tuple(latest) and version_tuple(current) and version_tuple(latest) > version_tuple(current):
        print(json.dumps({"systemMessage": (
            f"picodev-lab {latest} disponible (vous avez {current}). Pour mettre à jour : "
            f"claude plugin marketplace update picodev-lab, puis claude plugin update picodev-lab@picodev-lab "
            f"et /reload-plugins. Nouveautés : {REPO}/releases/tag/v{latest}")}, ensure_ascii=False))


# ── project brief (P5.2) ──

def fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


def heading_id(head):
    """The section id of a `## ` heading (French, English, or the id itself), "contact", or None; and its language."""
    for lang, table in (("fr", SECTIONS), ("en", SECTIONS_EN)):
        sid = next((i for i, label in table if head.startswith(fold(label)) or head == i.lower()), None)
        if sid:
            return sid, lang
    return ("contact", None) if head.startswith(CONTACT_HEADS) else (None, None)


def parse_spec(text):
    """`# title`, then one `## <heading>` per section.
    Returns (title, {id: text}, figures, language): a figure line `![caption](path)` is taken out of its
    section's text into figures, (section, caption, path); language is the headings' (fr when as many)."""
    title, sections, figures, cur, langs = "", {}, [], None, {"fr": 0, "en": 0}
    for line in text.splitlines():
        if line.startswith("# ") and not title:
            title = line[2:].strip()
        elif line.startswith("## "):
            cur, lang = heading_id(fold(line[3:]))
            if lang and cur != "production":  # the same word in both
                langs[lang] += 1
            if cur:
                sections[cur] = ""
        elif cur:
            fig = FIGURE_RE.match(line)
            if fig and cur != "contact":
                figures.append((cur, fig.group(1).strip(), fig.group(2)))
            else:
                sections[cur] += line + "\n"
    keep = {k: v.strip() for k, v in sections.items() if v.strip() and fold(v) not in ("a preciser", "to be specified")}
    return title, keep, figures, "en" if langs["en"] > langs["fr"] else "fr"


def load_figures(spec, refs):
    """The figures' files as brief_submit takes them; only PNG and SVG inside the spec's folder."""
    base = spec.resolve().parent
    if len(refs) > MAX_FIGURES:
        sys.exit(f"lab: {MAX_FIGURES} illustrations au plus dans la spec ({len(refs)} trouvées)")
    out, total = [], 0
    for section, caption, rel in refs:
        path = (base / rel).resolve()
        if base not in path.parents:
            sys.exit(f"lab: illustration hors du dossier de la spec, refusée : {rel}")
        kind = path.suffix.lower().lstrip(".")
        if kind not in ("png", "svg"):
            sys.exit(f"lab: illustration en PNG ou SVG seulement : {rel}")
        if not path.is_file():
            sys.exit(f"lab: illustration introuvable : {rel}")
        data = path.read_bytes()
        total += len(data)
        if len(data) > MAX_FIGURE or total > MAX_FIGURES_ALL:
            sys.exit(f"lab: illustrations trop lourdes ({MAX_FIGURE // 1024} Kio chacune, {MAX_FIGURES_ALL // 1024} Kio en tout) : {rel}")
        out.append({"section": section, "caption": (caption or path.stem)[:MAX_CAPTION], "type": kind,
                    "data": base64.b64encode(data).decode()})
    return out


def cmd_brief(a):
    spec = Path(a.spec)
    title, sections, refs, lang = parse_spec(spec.read_text(encoding="utf-8"))
    a.lang = a.lang or lang  # the spec's own language unless told
    if not title:
        sys.exit("lab: la spec n'a pas de titre (une ligne « # Intitulé du projet » en tête)")
    figures = load_figures(spec, refs) if not a.nda else []
    if not a.send:
        return preview(a, spec, title, sections, figures)
    args = {"title": title, "nda": a.nda, "send": True, "consent": a.consent, "language": a.lang}
    if not a.nda:
        args["sections"] = sections
        if figures:
            args["figures"] = figures
    if not (a.name and a.email):
        sys.exit("lab: --name et --email sont exigés pour un envoi")
    args["contact"] = {k: v for k, v in (("name", a.name), ("email", a.email), ("company", a.company), ("phone", a.phone)) if v}
    s = load_session(a)
    if s and a.with_session:
        args.update(session=s["session"], agent_token=s["agent_token"])
    out = call(hub_of(s), "brief_submit", args)
    out["figures"] = [f["caption"] for f in figures]
    write_pdf(spec, out)


def preview(a, spec, title, sections, figures):
    """spec_draft(pdf=true): nothing is sent; `missing` are the sections not yet filled."""
    args = {"title": title, "sections": sections, "language": a.lang, "pdf": True}
    if figures:
        args["figures"] = figures
    out = call(hub_of(load_session(a)), "spec_draft", args)
    write_pdf(spec, {
        "sent": False, "filename": out.get("filename"), "pdf": out.get("pdf"),
        "missing": [x["id"] for x in out.get("sections", []) if x.get("state") != "filled"],
        "next": out.get("next"), "ready": out.get("ready"), "language": a.lang,
        "figures": [f["caption"] for f in figures], "contact_in_pdf": "contact" in sections,
    })


def cmd_workspace(a):
    """The spec's own folder (architecture 0.16, « Espace de la spec »): created or completed, never overwritten."""
    d = Path(a.dir).expanduser().resolve()
    d.mkdir(parents=True, exist_ok=True)
    done = {"dir": str(d), "created": [], "kept": []}
    table = SECTIONS if a.lang != "en" else SECTIONS_EN
    spec = d / "spec-projet.md"
    if spec.exists():
        done["kept"].append(spec.name)
    else:
        title, todo = ("Intitulé du projet", "À préciser") if a.lang != "en" else ("Project title", "To be specified")
        spec.write_text(f"# {title}\n\n" + "".join(f"## {label}\n\n{todo}\n\n" for _, label in table), encoding="utf-8")
        done["created"].append(spec.name)
    figures = d / "spec-figures"
    done["kept" if figures.is_dir() else "created"].append("spec-figures/")
    figures.mkdir(exist_ok=True)
    print(json.dumps(done, ensure_ascii=False, indent=2))


def call(hub, tool, args):
    try:
        out = mcp(hub, tool, args, timeout=30)
    except HubError as e:
        sys.exit(f"lab: {e}")
    if not isinstance(out, dict):
        sys.exit(f"lab: réponse inattendue du labo : {str(out)[:200]}")
    return out


def write_pdf(spec, out):
    pdf = out.pop("pdf", None)
    if pdf:
        dest = spec.with_suffix(".pdf")
        dest.write_bytes(base64.b64decode(pdf))
        out["pdf_path"] = str(dest.resolve())
    print(json.dumps(out, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser(prog="lab.py")
    p.add_argument("--data", help="the plugin's data directory (${CLAUDE_PLUGIN_DATA})")
    p.add_argument("--project", help="the project's directory (${CLAUDE_PROJECT_DIR})")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("save", "show", "clear", "hook-push", "update-check"):
        sub.add_parser(name)
    sub.add_parser("push").add_argument("file", nargs="?", help="a file of the sketch, or its folder")
    sub.add_parser("autopush").add_argument("state", choices=["on", "off"])
    g = sub.add_parser("git")
    g.add_argument("state", choices=["status", "init", "off"])
    g.add_argument("folder", nargs="?", help="the sketch's folder (default: the last pushed, else sketch/)")
    w = sub.add_parser("workspace")
    w.add_argument("dir", help="the spec's folder (created if missing)")
    w.add_argument("--lang", choices=["fr", "en"], default="fr", help="the skeleton's headings")
    b = sub.add_parser("brief")
    b.add_argument("spec")
    for flag in ("--send", "--consent", "--nda", "--with-session"):
        b.add_argument(flag, action="store_true")
    for opt in ("--name", "--email", "--company", "--phone"):
        b.add_argument(opt)
    b.add_argument("--lang", choices=["fr", "en"], help="the spec's language (the PDF's headings); default: its headings'")
    a = p.parse_args()
    a.data = a.data or None  # "" when ${CLAUDE_PLUGIN_DATA} was not substituted: the fallback
    a.project = a.project or None
    globals()["cmd_" + a.cmd.replace("-", "_")](a)


if __name__ == "__main__":
    main()
