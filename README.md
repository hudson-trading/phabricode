# phabricode 

`phabricode` is a small Visual Studio Code extension that integrates some of Phabricator's functionality. 

Reviews are displayed in a dedicated view and loading a phab leverages VSCode's Comments API to in-line comments directly where you need them most, in the source code itself.

Please note this was written as a first foray into VSCode extensions and TypeScript - constructive criticism is most welcomed.
## Features

- Phabricator view that lists phabs, grouped by state (Ready to Land, Ready to Review, ...)
- Read-only integration with VSCode's Comments API - sources comments from phabs and in-lines them in code

# Build & Dependencies

```
> git clone https://github.com/hudson-trading/phabricode.git
> cd phabricode
> npm install
> npm run webpack-dev
```

`launch.json` and `tasks.json` have been included in the `.vscode` directory - feel free to modify those at will, they are simply there to ensure a working build task (that launches the extension in a new VSCode window for debugging) is present.

## Creating a VSIX file

This can be done via `vsce package -o phabricode.vsix --baseContentUrl 'https://github.com/hudson-trading/phabricode' --baseImagesUrl 'https://github.com/hudson-trading/phabricode'` - and installed via the Command Palette's "Extension: Install from VSIX".
## Dependencies

- Requires a `.arcrc` file in your home directory (the one returned by `require('os').homedir()`)

## Uninstalling

Use `code --list-extensions` to pick out the extension ID, followed by `code --uninstall-extension <extension id>`.

# Misc

## Multi-root Workspace

If you use VSCode with a multi-root workspace, you will need to tell `phabricode` which repos map to which folders. Those are defined in the setting called `phabricode.workspace.repoCallSignToWorkspaceFolder` (accessible via the Extension's setting page). The setting should look something like:

```
{
        "ProjectPepper": "proj-pepper-src"
}
```

Where `ProjectPepper` is the Phabricator's callsign, and `proj-pepper-src` is the workspace folder.

### Phabricator's repo callsign

On the Phabricator landing page, select Diffusion (`/diffusion`) and click on a repo. The callsign will be the part in the URL located: `https://phabricator.your-company.com/source/<call sign goes here>/`. 

### VSCode's folders

Look for a file called `.code-workspace` or `workspace.code-workspace` which should contain something like the below:

```
{
        "folders": [
                {
                        "path": "project-a"
                },
                {
                        "path": "project-b"
                },
        ],
```
## Backlog

- Periodic refresh of phabs (or update notifications)
- Colour-coding phabs by last update
- Integrate suggested edits, if they ever get exposed via Conduit (probably the same reason they don't show up in the mail notifications)
- Harbormaster integration on the phab landing page
- Lint/code clean-up