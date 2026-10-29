import {
  IDeferred,
  defer,
  walkTree,
  wrapFunction,
  type INode,
} from 'markmap-common';
import { Toolbar } from 'markmap-toolbar';
import {
  defaultOptions,
  deriveOptions,
  type IMarkmapJSONOptions,
  type Markmap,
} from 'markmap-view';

declare let mm: Markmap;

const vscode = acquireVsCodeApi();
const DEFAULT_MIN_FIT_SCALE = 0.6;
let minFitScale = DEFAULT_MIN_FIT_SCALE;
let firstTime = true;
let root: INode | undefined;
let style: HTMLStyleElement;
const foldMemory = new Map<string, number>();
const TYPING_WINDOW = 1000;
let lastDataAt = 0;
let userZoomed = false;
let lastFocusPath = '';
let followEnabled = true;
let active:
  | {
      node: INode;
      el: Element;
    }
  | undefined;
const activeNodeOptions: {
  placement?: 'center' | 'visible';
} = {};
let loading: IDeferred<void> | undefined;

const handlers = {
  async setData(data: {
    root?: INode;
    jsonOptions?: IMarkmapJSONOptions & {
      activeNode?: {
        placement?: 'center' | 'visible';
      };
      minFitScale?: number;
    };
  }) {
    loading = defer();
    const now = performance.now();
    const typing = lastDataAt > 0 && now - lastDataAt < TYPING_WINDOW;
    lastDataAt = now;
    const prevFolds = root ? captureFolds(root) : null;
    await mm.setData((root = data.root), {
      ...defaultOptions,
      ...deriveOptions(data.jsonOptions),
      duration: typing ? 0 : defaultOptions.duration,
    });
    activeNodeOptions.placement = data.jsonOptions?.activeNode?.placement;
    const scale = Number(data.jsonOptions?.minFitScale);
    minFitScale =
      Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_MIN_FIT_SCALE;
    if (root && prevFolds && restoreFolds(root, prevFolds)) {
      await mm.renderData();
    }
    if (firstTime) {
      await mm.fit();
      firstTime = false;
    }
    loading.resolve();
  },
  async setCursor(options: {
    line: number;
    autoExpand?: boolean;
    collapseOthers?: boolean;
  }) {
    await loading?.promise;
    const result =
      root &&
      findActiveNode({
        ...options,
        enabled: followEnabled,
      });
    if (!result) return;
    const { node, needRerender } = result;
    if (needRerender) {
      await mm.renderData();
      if (!userZoomed) {
        await mm.fit();
        const zoom = (mm.svg.node() as any)?.__zoom;
        if (zoom && zoom.k < minFitScale) {
          await mm.rescale(minFitScale);
          await mm.centerNode(node);
        }
      }
    }
    highlightNode(node);
  },
  setCSS(data: string) {
    if (!style) {
      style = document.createElement('style');
      document.head.append(style);
    }
    style.textContent = data || '';
  },
  checkTheme,
  downloadSvg(path: string) {
    const content = new XMLSerializer().serializeToString(mm.svg.node());
    vscode.postMessage({ type: 'downloadSvg', data: { content, path } });
  },
  toggleNode(recursive: boolean) {
    if (!active) return;
    mm.toggleNode(active.node, recursive);
  },
};
window.addEventListener('message', (e) => {
  const { type, data } = e.data;
  const handler = handlers[type];
  handler?.(data);
});
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement)?.closest('a');
  if (el) {
    const href = el.getAttribute('href');
    if (href.startsWith('#')) {
      const node = findHeading(href.slice(1));
      highlightNode(node);
    } else if (!href.includes('://')) {
      vscode.postMessage({
        type: 'openFile',
        data: href,
      });
    }
  }
});
vscode.postMessage({ type: 'refresh' });

const toolbar = new Toolbar();
const followBtn = createButton('跟随:开');
toolbar.register({
  id: 'followCursor',
  title: 'Toggle cursor follow',
  content: followBtn,
  onClick: () => {
    followEnabled = !followEnabled;
    followBtn.textContent = followEnabled ? '跟随:开' : '跟随:关';
    lastFocusPath = '';
    vscode.postMessage({ type: 'refresh' });
  },
});
toolbar.register({
  id: 'expandAll',
  title: 'Expand all',
  content: createButton('全开'),
  onClick: () => setAllFolds(0),
});
toolbar.register({
  id: 'collapseAll',
  title: 'Collapse all',
  content: createButton('全收'),
  onClick: () => setAllFolds(1),
});
toolbar.register({
  id: 'editAsText',
  title: 'Edit as text',
  content: createButton('Edit'),
  onClick: clickHandler('editAsText'),
});
toolbar.register({
  id: 'export',
  title: 'Export',
  content: createButton('Export'),
  onClick: clickHandler('export'),
});
toolbar.setItems([
  'zoomIn',
  'zoomOut',
  'fit',
  'recurse',
  'followCursor',
  'expandAll',
  'collapseAll',
  'editAsText',
  'export',
]);

checkTheme();

setTimeout(() => {
  initialize(mm);
  toolbar.attach(mm);
  Object.assign(toolbar.el.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '10',
  });
  document.body.append(toolbar.el);
});

function initialize(mm: Markmap) {
  mm.renderData = wrapFunction(mm.renderData, async (fn, ...args) => {
    await fn.call(mm, ...args);
    mm.g
      .selectAll<SVGGElement, INode>(function () {
        const nodes = Array.from(this.childNodes) as Element[];
        return nodes.filter((el) => el.tagName === 'g') as SVGGElement[];
      })
      .on(
        'dblclick.focus',
        (e, d) => {
          const lines = d.payload?.lines as string | undefined;
          const line = +lines?.split(',')[0];
          if (!isNaN(line))
            vscode.postMessage({ type: 'setFocus', data: line });
        },
        true,
      );
  });
  mm.toggleNode = wrapFunction(mm.toggleNode, async (fn, ...args) => {
    await fn.call(mm, ...args);
    recordUserFold(args[0] as INode, args[1] as boolean | undefined);
  });
  mm.fit = wrapFunction(mm.fit, async (fn, ...args) => {
    await fn.call(mm, ...args);
    userZoomed = false;
  });
  mm.svg.on('zoom.user', (event: { sourceEvent?: Event }) => {
    if (event?.sourceEvent) userZoomed = true;
  });
}

function recordUserFold(treeNode?: INode, recursive?: boolean) {
  if (!treeNode) return;
  const record = (node: INode) => {
    if (node.children?.length) {
      foldMemory.set(foldKey(node), node.payload?.fold ? 1 : 0);
    }
  };
  record(treeNode);
  if (recursive) {
    walkTree(treeNode, (node, next) => {
      record(node);
      next();
    });
  }
}

function checkTheme() {
  // https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content
  const isDark = ['vscode-dark', 'vscode-high-contrast'].some((cls) =>
    document.body.classList.contains(cls),
  );
  document.documentElement.classList[isDark ? 'add' : 'remove']('markmap-dark');
}

function createButton(text: string) {
  const el = document.createElement('div');
  el.className = 'btn-text';
  el.textContent = text;
  return el;
}

function clickHandler(type: string) {
  return () => {
    vscode.postMessage({ type });
  };
}

function findHeading(id: string) {
  function dfs(node: INode) {
    if (!/^h\d$/.test(node.payload.tag as string)) return false;
    const normalizedId = node.content.trim().replace(/\W/g, '-').toLowerCase();
    if (normalizedId === id) {
      target = node;
      return true;
    }
    return node.children?.some(dfs);
  }
  let target: INode | undefined;
  dfs(root);
  return target;
}

function findActiveNode({
  line,
  autoExpand = true,
  collapseOthers = false,
  enabled = true,
}: {
  line: number;
  autoExpand?: boolean;
  collapseOthers?: boolean;
  enabled?: boolean;
}) {
  function dfs(node: INode, ancestors: INode[] = []) {
    const [start, end] =
      (node.payload?.lines as string)?.split(',').map((s) => +s) || [];
    if (start >= 0 && start <= line && line < end) {
      best = node;
      bestAncestors = ancestors;
    }
    ancestors = [...ancestors, node];
    node.children?.forEach((child) => {
      dfs(child, ancestors);
    });
  }
  let best: INode | undefined;
  let bestAncestors: INode[] = [];
  dfs(root);
  if (!best) return;
  const currentFocus = focusKey(best);
  let needRerender = false;
  if (enabled && currentFocus !== lastFocusPath) {
    const autoExpandNow = enabled && autoExpand;
    const collapseNow = enabled && collapseOthers;
    const path = [...bestAncestors, best];
    if (autoExpandNow || collapseNow) {
      bestAncestors.forEach((node) => {
        if (node.payload?.fold) {
          node.payload.fold = 0;
          needRerender = true;
        }
      });
    }
    if (collapseNow && path.length > 1) {
      let folded = 0;
      path.forEach((node, index) => {
        const next = path[index + 1];
        node.children?.forEach((child) => {
          if (child === next) return;
          if (!child.children?.length) return;
          if (child.payload?.fold) return;
          if (foldMemory.get(foldKey(child)) === 0) return;
          child.payload.fold = 1;
          needRerender = true;
          folded += 1;
        });
      });
      if (folded) logData(`[follow] line ${line}: folded ${folded} sibling(s)`);
    }
    lastFocusPath = currentFocus;
  }
  return { node: best, needRerender };
}

function foldKey(node: INode) {
  return `${node.state?.depth ?? 0} ${node.content}`;
}

function focusKey(node: INode) {
  const [start] =
    (node.payload?.lines as string)?.split(',').map((s) => +s) || [];
  return Number.isFinite(start) && start >= 0 ? `L${start}` : foldKey(node);
}

function logData(text: string) {
  vscode.postMessage({ type: 'log', data: text });
}

function captureFolds(treeNode: INode) {
  const map = new Map<string, number>();
  walkTree(treeNode, (node, next) => {
    if (node.children?.length) {
      map.set(foldKey(node), node.payload?.fold ? 1 : 0);
    }
    next();
  });
  return map;
}

function restoreFolds(treeNode: INode, map: Map<string, number>) {
  let changed = 0;
  walkTree(treeNode, (node, next) => {
    if (node.children?.length) {
      const key = foldKey(node);
      if (map.has(key)) {
        const fold = map.get(key) || 0;
        if ((node.payload?.fold ? 1 : 0) !== fold) {
          node.payload = { ...node.payload, fold };
          changed += 1;
        }
      }
    }
    next();
  });
  if (changed) logData(`[state] restored ${changed} fold(s) after edit`);
  return changed;
}

async function setAllFolds(fold: number) {
  if (!root) return;
  walkTree(root, (node, next) => {
    if (node !== root && node.children?.length) {
      node.payload = { ...node.payload, fold };
    }
    next();
  });
  await mm.renderData();
  if (!userZoomed) await mm.fit();
}

async function highlightNode(node?: INode) {
  await mm.setHighlight(node);
  if (!node) return;
  await mm[
    activeNodeOptions.placement === 'center' ? 'centerNode' : 'ensureVisible'
  ](node, {
    bottom: 80,
  });
}
