# markmap-vscode

> 个人改造版，基于 [markmap/markmap-vscode](https://github.com/markmap/markmap-vscode)（MIT，作者 Gerald）。
> 与官方版本无关联，也不发布到扩展商店。

[![vscode](https://img.shields.io/visual-studio-marketplace/v/gera2ld.markmap-vscode)](https://marketplace.visualstudio.com/items?itemName=gera2ld.markmap-vscode)
[![open vsx](https://img.shields.io/open-vsx/v/gera2ld/markmap-vscode)](https://open-vsx.org/extension/gera2ld/markmap-vscode)

This extension integrates [markmap](https://markmap.js.org/) into VSCode.

## Features

- Preview markdown files as markmap
- Edit markdown files in a text editor and the markmap will update on the fly
- Works offline

<img width="1014" alt="markmap" src="https://user-images.githubusercontent.com/3139113/97068999-5f9e8480-15ff-11eb-8222-43d26cecade5.png">

## Usage

### Command Palette

Open a markdown file. Then open the Command Palette (⇧⌘P) and search `Open as markmap`, press enter.

### Context menu

Right click on a markdown file, then choose `Open as markmap`.

### Button on title-bar

Open a markdown file. Find the markmap icon on the editor title-bar and click it.

![title button](https://user-images.githubusercontent.com/3139113/110966366-25f0cf00-8390-11eb-9a16-3c4d66712f47.png)

## Configuration

### Custom CSS

Extra CSS to customize the style of markmap.

### Default Options

Default options for Markmap, see <https://markmap.js.org/docs/json-options#markmap-for-vscode> for more details.

## Local additions in this fork

Two extra behaviors, both driven by `markmap.defaultOptions`:

- `"autoExpand": true` — expand the ancestor path of the node under the cursor (upstream feature).
- `"collapseOthers": true` — additionally fold every branch that is not on the cursor path, so the map only shows where you are editing. Values are read on every cursor move and every edit; `initialExpandLevel` still applies first.
- `"minFitScale": 0.6` — when the map is re-fitted after folding, never zoom out below this scale, so text stays readable on branches with large content.
