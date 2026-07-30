# Source encoding

Every tracked text file in this repository is **UTF-8 without a byte-order mark**. This is not a
style preference: BOMs and mis-encoded characters have reached `main` three times and each time
they arrived silently, through a shell that nobody suspected.

## What went wrong

Windows PowerShell 5.1 is the default `powershell.exe` on this machine and its file cmdlets are
encoding hazards:

| Cmdlet | Behaviour on PowerShell 5.1 |
| --- | --- |
| `Set-Content -Encoding UTF8` | writes UTF-8 **with** a BOM (`EF BB BF`) |
| `Out-File -Encoding utf8` | writes UTF-8 **with** a BOM |
| `Add-Content -Encoding UTF8` | writes UTF-8 **with** a BOM when it creates the file |
| `Get-Content` (no `-Encoding`) | decodes the file using the **ANSI code page** (Windows-1252 here), not UTF-8 |
| `>` / `>>` | writes **UTF-16LE** (`FF FE`) |

Individually these are annoying. Combined in the ordinary "read a file, change it, write it back"
round-trip they destroy the file in one step:

```powershell
# NEVER do this. It corrupts the file.
$text = Get-Content .\index.ts -Raw
Set-Content .\index.ts -Value $text -Encoding UTF8
```

`Get-Content` reads the UTF-8 bytes `C3 B3` (`ó`) as two Windows-1252 characters, U+00C3 and
U+00B3. `Set-Content -Encoding UTF8` then encodes *those two characters* as UTF-8, producing four
bytes, and prepends a BOM:

```
before   6D C3 B3 64 75 6C 6F 73                 m ó d u l o s
after    EF BB BF 6D C3 83 C2 B3 64 75 6C 6F 73  BOM + m U+00C3 U+00B3 d u l o s
```

That is exactly the damage seen on `main`: `módulos` and `expressões` in
`app-v2/src/main/modules/index.ts` turned into their U+00C3-prefixed forms, and three files grew a
BOM. The tell-tale is that the offending commits' **own commit messages also start with a BOM** --
the message file was written by the same mis-encoding shell.

## The rules

**Writing files**

```powershell
# PowerShell 5.1 - the only safe primitive
[IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))

# PowerShell 7+
Set-Content -Path $path -Value $text -Encoding utf8NoBOM
```

**Reading files**

```powershell
# PowerShell 5.1 - always name the encoding, or the ANSI code page is used
[IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
Get-Content -Path $path -Raw -Encoding UTF8   # acceptable for reading; NOT for writing
```

**Node**

```js
readFileSync(path, 'utf8')          // never readFileSync(path).toString() with a guessed encoding
writeFileSync(path, text, 'utf8')   // always explicit
```

Never round-trip a file through a tool whose read encoding you have not specified.

**Commit messages** written to a file for `git commit -F` follow the same rule. A BOM in a commit
message means the tool that wrote it will corrupt source files next.

## The guards

| Guard | Scope | When it fires |
| --- | --- | --- |
| `scripts/check-encoding.mjs` (CI job `Encoding integrity`) | **every tracked text file** | pull request and push to `main` |
| `app-v2/src/renderer/src/i18n-encoding.test.ts` | `app-v2/src`, code/asset extensions only | `npm test` |
| `.githooks/pre-commit` | staged files | locally, opt-in |
| `.githooks/commit-msg` | the commit message | locally, opt-in |

`.gitattributes` cannot help here. There is no attribute that strips or rejects a BOM;
`working-tree-encoding=UTF-8` is a no-op because UTF-8 is already git's in-index encoding. A byte
scan is the only mechanism that actually refuses the content.

### Run the scan

```bash
node scripts/check-encoding.mjs           # scan every tracked file
node scripts/check-encoding.mjs --staged  # scan staged changes only
node scripts/check-encoding.mjs --fix     # strip UTF-8 BOMs in place, then re-scan
```

From `app-v2/` the same scan is available as `npm run check:encoding`.

### Enable the local hooks (recommended, one time per clone or worktree)

```bash
git config core.hooksPath .githooks
```

The hooks are plain `sh` and only need `node` and `git` on `PATH`. They stop the corruption before
a commit exists, which is strictly better than CI catching it after a push.
