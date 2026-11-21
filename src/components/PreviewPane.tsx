import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { useText } from '../preferences';

if (!pdfjs.GlobalWorkerOptions.workerPort) {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

export interface PreviewHandle {
  jumpTo: (page: number, x: number, y: number, image?: boolean) => void;
  clearHighlight: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface Highlight {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  image?: boolean;
}

interface PdfPageData {
  number: number;
  viewport: pdfjs.PageViewport;
}

type Matrix = [number, number, number, number, number, number];
type PdfLink = { id: string; rect: number[]; url?: string; dest?: string | unknown[] };

async function matchingImage(page: pdfjs.PDFPageProxy, x: number, y: number) {
  const { fnArray, argsArray } = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  let matrix = identity;
  const stack: Matrix[] = [];
  let closest: Omit<Highlight, 'page'> | undefined;
  let bestDistance = 18;
  let bestCenterDistance = Infinity;
  const consider = (transform: Matrix) => {
    const combined = pdfjs.Util.transform(viewport.transform, transform);
    const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) =>
      [combined[0] * u + combined[2] * v + combined[4], combined[1] * u + combined[3] * v + combined[5]]);
    const left = Math.min(...points.map((point) => point[0]));
    const top = Math.min(...points.map((point) => point[1]));
    const right = Math.max(...points.map((point) => point[0]));
    const bottom = Math.max(...points.map((point) => point[1]));
    const distance = Math.hypot(Math.max(left - x, 0, x - right), Math.max(top - y, 0, y - bottom));
    const centerDistance = Math.hypot((left + right) / 2 - x, (top + bottom) / 2 - y);
    if (distance > bestDistance || (distance === bestDistance && centerDistance >= bestCenterDistance)) return;
    bestDistance = distance;
    bestCenterDistance = centerDistance;
    closest = { x: left, y: top, width: right - left, height: bottom - top, image: true };
  };
  const ops = pdfjs.OPS;
  fnArray.forEach((fn, index) => {
    const args = argsArray[index];
    if (fn === ops.save || fn === ops.paintFormXObjectBegin) {
      stack.push(matrix);
      if (fn === ops.paintFormXObjectBegin && args[0]) matrix = pdfjs.Util.transform(matrix, args[0]) as Matrix;
    } else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) {
      matrix = stack.pop() ?? identity;
    } else if (fn === ops.transform) {
      matrix = pdfjs.Util.transform(matrix, args) as Matrix;
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      consider(matrix);
    } else if (fn === ops.paintImageXObjectRepeat) {
      const [, scaleX, scaleY, positions] = args;
      for (let i = 0; i < positions.length; i += 2) {
        consider(pdfjs.Util.transform(matrix, [scaleX, 0, 0, scaleY, positions[i], positions[i + 1]]) as Matrix);
      }
    } else if (fn === ops.paintInlineImageXObjectGroup) {
      for (const entry of args[1]) consider(pdfjs.Util.transform(matrix, entry.transform) as Matrix);
    }
  });
  return closest;
}

const zoomBy = (scale: number, direction: number) => Math.max(0.4, Math.min(4, scale + direction * 0.2));

function pdfCaret(x: number, y: number) {
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret || !caret.startContainer.parentElement?.closest('.pdf-text-layer')) return null;
  return { node: caret.startContainer, offset: caret.startOffset };
}

class PdfAssets {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    return new Uint8Array(await window.api.readPdfAsset(kind, filename));
  }
}

interface Props {
  pdfBytes: ArrayBuffer | null;
  onDoubleClick: (page: number, x: number, y: number) => void;
}

function PdfPage({
  pdfDoc,
  pageNumber,
  viewport,
  highlight,
  onDoubleClick,
  registerRef,
  onDestination,
}: {
  pdfDoc: pdfjs.PDFDocumentProxy;
  pageNumber: number;
  viewport: PdfPageData['viewport'];
  highlight: Highlight | null;
  onDoubleClick: (page: number, x: number, y: number) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onDestination: (dest: string | unknown[]) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PdfLink[]>([]);

  useEffect(() => {
    let active = true;
    setLinks([]);
    void pdfDoc.getPage(pageNumber).then((page) => page.getAnnotations({ intent: 'display' })).then((annotations) => {
      if (active) setLinks(annotations.filter((item) => item.subtype === 'Link' &&
        (item.dest || /^(?:https?:|mailto:)/i.test(item.url ?? ''))));
    }).catch(console.error);
    return () => { active = false; };
  }, [pdfDoc, pageNumber]);

  useEffect(() => {
    registerRef(wrapRef.current);
  }, [registerRef]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<pdfjs.PDFPageProxy['render']> | undefined;
    let textLayer: pdfjs.TextLayer | undefined;
    const text = textRef.current;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas || !text) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      renderTask = page.render({ canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      text.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
      textLayer = new pdfjs.TextLayer({ container: text, viewport, textContentSource: page.streamTextContent() });
      await Promise.all([renderTask.promise, textLayer.render()]);
    })().catch((error) => { if (!cancelled) console.error(error); });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      text?.replaceChildren();
    };
  }, [pdfDoc, pageNumber, viewport]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.altKey || (e.target as Element).closest('.pdf-link')) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / viewport.scale;
    const y = (e.clientY - rect.top) / viewport.scale;
    onDoubleClick(pageNumber, x, y);
  };

  return (
    <div className="pdf-page" ref={wrapRef} onDoubleClick={handleDoubleClick}>
      <canvas ref={canvasRef} />
      <div className="pdf-text-layer" ref={textRef} />
      {links.map(({ id, rect, url, dest }) => {
        const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
        const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
        return <a key={id} className="pdf-link" href={url ?? '#'} title={url ?? (typeof dest === 'string' ? dest : 'PDF destination')}
          style={{ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }}
          onClick={(event) => {
            event.preventDefault();
            if (event.altKey) return;
            if (dest) void onDestination(dest).catch(console.error);
            else if (url) void window.api.openPdfLink?.(url).catch(console.error);
          }} />;
      })}
      {highlight && (
        <div
          className={highlight.image ? 'pdf-highlight pdf-highlight-image' : 'pdf-highlight'}
          style={{
            left: highlight.x * viewport.scale, top: highlight.y * viewport.scale,
            width: highlight.width * viewport.scale, height: highlight.height * viewport.scale,
          }}
        />
      )}
      <div className="pdf-page-num">{pageNumber}</div>
    </div>
  );
}

const PreviewPane = forwardRef<PreviewHandle, Props>(({ pdfBytes, onDoubleClick }, ref) => {
  const t = useText();
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [scale, setScale] = useState(1.3);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moving: boolean } | null>(null);
  const textAnchor = useRef<{ id: number; x: number; y: number; caret: NonNullable<ReturnType<typeof pdfCaret>> } | null>(null);
  const lastPan = useRef(0);
  const jumpId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setPages([]);
    setPdfDoc(null);
    setHighlight(null);
    jumpId.current++;
    if (!pdfBytes) return;
    (async () => {
      try {
        // PDF.js transfers its buffer to the worker. Retain the original for export.
        const task = pdfjs.getDocument({
          data: new Uint8Array(pdfBytes.slice(0)),
          cMapPacked: true,
          BinaryDataFactory: PdfAssets,
          useWorkerFetch: false,
        });
        const doc = await task.promise;
        if (cancelled) return;
        setPdfDoc(doc);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes]);

  useEffect(() => {
    if (!pdfDoc) {
      setPages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const loaded: PdfPageData[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        if (cancelled) return;
        loaded.push({ number: i, viewport: page.getViewport({ scale }) });
      }
      if (!cancelled) setPages(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      setScale((value) => zoomBy(value, event.deltaY < 0 ? 1 : -1));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [pdfBytes, error]);

  useEffect(() => {
    function stopPan() {
      const drag = pan.current;
      const view = containerRef.current;
      if (drag && view?.hasPointerCapture(drag.id)) view.releasePointerCapture(drag.id);
      else pan.current = null;
    }
    function keys(event: KeyboardEvent) {
      setAltHeld(event.altKey);
      if (!event.altKey) stopPan();
    }
    function blur() { setAltHeld(false); stopPan(); }
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', keys);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    const view = containerRef.current;
    const page = highlight && pageRefs.current[highlight.page];
    const info = highlight && pages.find((entry) => entry.number === highlight.page);
    if (!view || !page || !highlight || !info) return;
    const bounds = page.getBoundingClientRect();
    const viewport = view.getBoundingClientRect();
    const factor = info.viewport.scale;
    view.scrollTo({
      left: view.scrollLeft + bounds.left - viewport.left + (highlight.x + highlight.width / 2) * factor - view.clientWidth / 2,
      top: view.scrollTop + bounds.top - viewport.top + (highlight.y + highlight.height / 2) * factor - view.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [highlight, pages]);

  useImperativeHandle(
    ref,
    () => ({
      jumpTo(page, x, y, image) {
        const id = ++jumpId.current;
        const fallback = { page, x: Math.max(0, x - 4), y: Math.max(0, y - 13), width: 70, height: 15 };
        if (!pdfDoc || !image) {
          setHighlight(fallback);
          return;
        }
        void pdfDoc.getPage(page).then((pdfPage) => matchingImage(pdfPage, x, y)).then((bounds) => {
          if (id === jumpId.current) setHighlight(bounds ? { page, ...bounds } : fallback);
        }).catch(() => { if (id === jumpId.current) setHighlight(fallback); });
      },
      clearHighlight() {
        jumpId.current++;
        setHighlight(null);
      },
      zoomIn() {
        setScale((s) => zoomBy(s, 1));
      },
      zoomOut() {
        setScale((s) => zoomBy(s, -1));
      },
    }),
    [pdfDoc],
  );

  if (error) {
    return <div className="preview preview-empty">{t('预览失败', 'Preview failed')} · {error}</div>;
  }
  if (!pdfBytes) {
    return <div className="preview preview-empty">{t('编译后显示 PDF 预览', 'Compile to preview the PDF')}</div>;
  }

  return (
    <div className={`preview preview-pan${altHeld ? ' pan-ready' : ''}`} ref={containerRef}
      onPointerDown={(event) => {
        setAltHeld(event.altKey);
        if (event.button !== 0 || !(event.target as Element).closest('.pdf-page')) return;
        if (!event.altKey) {
          if ((event.target as Element).closest('.pdf-link')) return;
          const caret = pdfCaret(event.clientX, event.clientY);
          textAnchor.current = caret ? { id: event.pointerId, x: event.clientX, y: event.clientY, caret } : null;
          return;
        }
        textAnchor.current = null;
        event.preventDefault();
        const { scrollLeft, scrollTop } = event.currentTarget;
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scrollLeft, top: scrollTop, moving: false };
      }}
      onPointerMove={(event) => {
        setAltHeld(event.altKey);
        const anchor = textAnchor.current;
        if (anchor && anchor.id === event.pointerId && !event.altKey && (event.buttons & 1) &&
          Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) >= 4 && anchor.caret.node.isConnected) {
          const end = pdfCaret(event.clientX, event.clientY);
          if (end) window.getSelection()?.setBaseAndExtent(anchor.caret.node, anchor.caret.offset, end.node, end.offset);
        }
        const drag = pan.current;
        if (!drag || drag.id !== event.pointerId) return;
        if (!(event.buttons & 1) || !event.altKey) {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          else pan.current = null;
          return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const view = event.currentTarget;
        if (!drag.moving) {
          if (Math.hypot(dx, dy) < 4) return;
          drag.moving = true;
          view.setPointerCapture(event.pointerId);
          view.classList.add('panning');
        }
        view.scrollLeft = drag.left - dx;
        view.scrollTop = drag.top - dy;
      }}
      onLostPointerCapture={(event) => {
        if (pan.current?.moving) lastPan.current = Date.now();
        pan.current = null;
        event.currentTarget.classList.remove('panning');
      }}
      onPointerCancel={() => { textAnchor.current = null; if (!pan.current?.moving) pan.current = null; }}
      onPointerUp={() => { textAnchor.current = null; if (!pan.current?.moving) pan.current = null; }}>
      {pdfDoc && pages.map((p) => (
        <PdfPage
          key={p.number}
          pdfDoc={pdfDoc}
          pageNumber={p.number}
          viewport={p.viewport}
          highlight={highlight && highlight.page === p.number ? highlight : null}
          onDestination={async (dest) => {
            const target = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
            if (!target) return;
            const first = target[0] as number | Parameters<pdfjs.PDFDocumentProxy['getPageIndex']>[0];
            const number = (typeof first === 'number' ? first : await pdfDoc.getPageIndex(first)) + 1;
            const page = pageRefs.current[number];
            const view = containerRef.current;
            const viewport = pages.find((entry) => entry.number === number)?.viewport;
            if (!page || !view || !viewport) return;
            const kind = (target[1] as { name?: string })?.name;
            let y = 0;
            if (['XYZ', 'FitH', 'FitBH', 'FitR'].includes(kind ?? '')) {
              const top = target[kind === 'XYZ' ? 3 : kind === 'FitR' ? 5 : 2];
              if (typeof top === 'number') [, y] = viewport.convertToViewportPoint(viewport.viewBox[0], top);
            }
            jumpId.current++;
            setHighlight(null);
            view.scrollTo({ top: view.scrollTop + page.getBoundingClientRect().top - view.getBoundingClientRect().top + y, behavior: 'smooth' });
          }}
          onDoubleClick={(page, x, y) => { if (Date.now() - lastPan.current > 250) onDoubleClick(page, x, y); }}
          registerRef={(el) => {
            pageRefs.current[p.number] = el;
          }}
        />
      ))}
    </div>
  );
});

PreviewPane.displayName = 'PreviewPane';
export default PreviewPane;
