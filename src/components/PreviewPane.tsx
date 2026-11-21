import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { useText } from '../preferences';

if (!pdfjs.GlobalWorkerOptions.workerPort) {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

export interface PreviewHandle {
  jumpTo: (page: number, x: number, y: number) => void;
  clearHighlight: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface Highlight {
  page: number;
  x: number;
  y: number;
}

interface PdfPageData {
  number: number;
  viewport: { width: number; height: number; scale: number };
}

const zoomBy = (scale: number, direction: number) => Math.max(0.4, Math.min(4, scale + direction * 0.2));

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
}: {
  pdfDoc: any;
  pageNumber: number;
  viewport: PdfPageData['viewport'];
  highlight: Highlight | null;
  onDoubleClick: (page: number, x: number, y: number) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerRef(wrapRef.current);
  }, [registerRef]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderTask = page.render({ canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [pdfDoc, pageNumber, viewport]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / viewport.scale;
    const y = (e.clientY - rect.top) / viewport.scale;
    onDoubleClick(pageNumber, x, y);
  };

  return (
    <div className="pdf-page" ref={wrapRef}>
      <canvas ref={canvasRef} onDoubleClick={handleDoubleClick} />
      {highlight && (
        <div
          className="pdf-highlight"
          style={{ left: highlight.x * viewport.scale, top: highlight.y * viewport.scale }}
        />
      )}
      <div className="pdf-page-num">{pageNumber}</div>
    </div>
  );
}

const PreviewPane = forwardRef<PreviewHandle, Props>(({ pdfBytes, onDoubleClick }, ref) => {
  const t = useText();
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [scale, setScale] = useState(1.3);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moving: boolean } | null>(null);
  const lastPan = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setPages([]);
    setPdfDoc(null);
    setHighlight(null);
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

  useImperativeHandle(
    ref,
    () => ({
      jumpTo(page, x, y) {
        setHighlight({ page, x, y });
        const el = pageRefs.current[page];
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      clearHighlight() {
        setHighlight(null);
      },
      zoomIn() {
        setScale((s) => zoomBy(s, 1));
      },
      zoomOut() {
        setScale((s) => zoomBy(s, -1));
      },
    }),
    [],
  );

  if (error) {
    return <div className="preview preview-empty">{t('预览失败', 'Preview failed')} · {error}</div>;
  }
  if (!pdfBytes) {
    return <div className="preview preview-empty">{t('编译后显示 PDF 预览', 'Compile to preview the PDF')}</div>;
  }

  return (
    <div className="preview preview-pan" ref={containerRef}
      onPointerDown={(event) => {
        if (event.button !== 0 || !(event.target as Element).closest('.pdf-page')) return;
        const { scrollLeft, scrollTop } = event.currentTarget;
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scrollLeft, top: scrollTop, moving: false };
      }}
      onPointerMove={(event) => {
        const drag = pan.current;
        if (!drag || drag.id !== event.pointerId) return;
        if (!(event.buttons & 1)) { pan.current = null; return; }
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
      onPointerUp={() => { if (!pan.current?.moving) pan.current = null; }}>
      {pages.map((p) => (
        <PdfPage
          key={p.number}
          pdfDoc={pdfDoc}
          pageNumber={p.number}
          viewport={p.viewport}
          highlight={highlight && highlight.page === p.number ? highlight : null}
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
