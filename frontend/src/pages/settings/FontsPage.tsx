import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronRight, Type, X } from 'lucide-react';
import {
  APP_FONTS,
  applyAppFont,
  getFontPreviewStack,
  loadFontForPreview,
  type AppFontId,
} from '@/lib/fonts';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

/**
 * Dedicated app-font screen.
 * Settings → Fonts → list of names → tap → centered preview + confirm.
 */
export function FontsPage() {
  const fontId = useThemeStore((s) => s.fontId);
  const setFontId = useThemeStore((s) => s.setFontId);
  const [previewFontId, setPreviewFontId] = useState<AppFontId | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [applying, setApplying] = useState(false);

  const openPreview = (id: AppFontId) => {
    setPreviewReady(id === 'system');
    setPreviewFontId(id);
    void loadFontForPreview(id).then((ok) => {
      setPreviewReady(true);
      if (!ok && id !== 'system') {
        toast.message('Font is loading…', {
          description: 'Preview updates when the download finishes. Stay online briefly.',
        });
      }
    });
  };

  const closePreview = () => {
    if (applying) return;
    setPreviewFontId(null);
  };

  const confirmFont = async (id: AppFontId, label: string) => {
    setApplying(true);
    try {
      const ok = await applyAppFont(id);
      setFontId(id);
      setPreviewFontId(null);
      toast.success(
        id === 'system'
          ? 'Using your phone system font'
          : ok
            ? `Font set to ${label}`
            : `${label} applied (finishing download…)`
      );
    } finally {
      setApplying(false);
    }
  };

  const previewFont = previewFontId
    ? APP_FONTS.find((f) => f.id === previewFontId) || APP_FONTS[0]
    : null;
  const previewStack = previewFont ? getFontPreviewStack(previewFont.id) : '';
  const isActive = previewFont ? fontId === previewFont.id : false;

  const previewModal =
    previewFont &&
    createPortal(
      <div
        className="font-preview-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${previewFont.label}`}
      >
        <button
          type="button"
          className="font-preview-backdrop"
          aria-label="Close preview"
          onClick={closePreview}
        />
        <div className="font-preview-sheet">
          {/* Fixed header — always visible */}
          <header className="font-preview-header">
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate">{previewFont.label}</h2>
              <p className="text-xs text-muted-foreground truncate">{previewFont.description}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={closePreview}
              disabled={applying}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </header>

          {/* Preview body — compact so it fits without page scroll */}
          <div className="font-preview-body">
            {!previewReady && previewFont.id !== 'system' ? (
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
                Loading font preview…
              </div>
            ) : (
              <div
                key={`${previewFont.id}-${previewReady ? 'on' : 'off'}`}
                className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-2.5"
                style={{ fontFamily: previewStack }}
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  How it will look
                </p>
                <p className="text-xl font-bold leading-snug">Enterprise IMS</p>
                <p className="text-sm font-semibold">Dashboard · Products · Sales</p>
                <p className="text-sm leading-snug text-muted-foreground">
                  The quick brown fox jumps over the lazy dog.
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  12,500 · Stock 48 · Order #1042
                </p>
              </div>
            )}
            {isActive && (
              <p className="text-xs text-center text-primary font-medium flex items-center justify-center gap-1 mt-3">
                <Check className="h-3.5 w-3.5" /> This is your current app font
              </p>
            )}
          </div>

          {/* Fixed footer — always on screen */}
          <footer className="font-preview-footer">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-11"
              onClick={closePreview}
              disabled={applying}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 h-11"
              disabled={isActive || applying}
              loading={applying}
              onClick={() => void confirmFont(previewFont.id as AppFontId, previewFont.label)}
            >
              <Check className="h-4 w-4" />
              {isActive ? 'In use' : 'Use this font'}
            </Button>
          </footer>
        </div>
      </div>,
      document.body
    );

  const currentLabel = APP_FONTS.find((f) => f.id === fontId)?.label || 'Phone system font';

  return (
    <div className="page-container fit-x pb-6">
      <div className="flex items-center gap-2 mb-1">
        <Link
          to="/app/settings"
          aria-label="Back to Settings"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">Fonts</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Current: <strong>{currentLabel}</strong> · tap a name to preview
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-4 w-4 text-primary" />
            Choose app font
          </CardTitle>
          <CardDescription>
            Only names are listed. Tap one to see a preview, then confirm if you like it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {APP_FONTS.map((font) => {
              const selected = fontId === font.id;
              return (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => openPreview(font.id as AppFontId)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors min-h-[3.25rem] ${
                    selected ? 'bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <Type className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{font.label}</p>
                      {selected ? (
                        <p className="text-[11px] text-primary font-medium">Currently in use</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {font.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {previewModal}
    </div>
  );
}
