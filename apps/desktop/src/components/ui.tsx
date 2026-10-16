import { AlertTriangle, Loader2, type LucideIcon, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { t } from "../i18n";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold hover:bg-accent-strong active:bg-accent-deep shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.4)]",
  secondary:
    "border border-line-strong bg-raised text-fg hover:bg-overlay hover:border-fg-dim/40 active:bg-surface",
  ghost: "text-fg-muted hover:bg-overlay hover:text-fg active:bg-raised",
  // Destructive actions are always solid red, never outlined.
  danger:
    "bg-destructive text-white font-semibold hover:bg-destructive-hover active:bg-destructive-pressed shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  busy = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const Glyph = busy ? Loader2 : Icon;
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-ui",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {Glyph && (
        <Glyph
          className={cx("size-3.5 shrink-0", busy && "animate-spin")}
          strokeWidth={2.25}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon: LucideIcon;
  active?: boolean;
  size?: "sm" | "md";
  /** Destructive actions are solid red. */
  tone?: "danger";
}

export function IconButton({
  label,
  icon: Icon,
  active = false,
  size = "md",
  tone,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "size-6" : "size-8",
        tone === "danger"
          ? "bg-destructive text-white hover:bg-destructive-hover active:bg-destructive-pressed"
          : active
            ? "bg-accent/15 text-accent"
            : "text-fg-muted hover:bg-overlay hover:text-fg",
        className,
      )}
      {...rest}
    >
      <Icon
        className={size === "sm" ? "size-3.5" : "size-4"}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Rendered to the right of the label, e.g. a counter. */
  aside?: ReactNode;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, aside, children }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-fg-muted">
          {label}
        </label>
        {aside && <span className="text-2xs text-fg-dim">{aside}</span>}
      </div>
      {children(id)}
      {error ? (
        <p className="text-2xs text-danger">{error}</p>
      ) : (
        hint && <p className="text-2xs leading-4 text-fg-dim">{hint}</p>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cx("size-4 animate-spin text-fg-dim", className)}
      aria-label={t("common:loading")}
    />
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex h-full w-full flex-col items-center justify-center text-center",
        compact ? "gap-2 p-4" : "gap-3 p-8",
      )}
    >
      <div
        className={cx(
          "flex items-center justify-center rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/20 to-accent/5 text-accent shadow-[0_8px_24px_-8px_rgb(255_122_31/0.45),inset_0_1px_0_rgb(255_255_255/0.12)]",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon
          className={compact ? "size-4" : "size-5"}
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3
          className={cx(
            "font-semibold text-fg",
            compact ? "text-ui" : "text-sm",
          )}
        >
          {title}
        </h3>
        <p className="text-xs leading-5 text-fg-muted">{description}</p>
      </div>
      {action && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={t("common:somethingWentWrong")}
      description={message}
      action={
        onRetry && <Button onClick={onRetry}>{t("common:tryAgain")}</Button>
      }
    />
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-raised text-fg-muted",
  accent: "border-accent/30 bg-accent/10 text-accent",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-2xs font-medium whitespace-nowrap",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Shows measured progress. Pass `null` when the amount of work is unknown:
 * the bar then animates without implying a percentage.
 */
export function ProgressBar({
  value,
  tone = "accent",
}: {
  value: number | null;
  tone?: "accent" | "ok";
}) {
  const fill = tone === "ok" ? "bg-ok" : "bg-accent";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      className="h-1 w-full overflow-hidden rounded-full bg-line-strong"
    >
      {value === null ? (
        <div
          className={cx(
            "h-full w-2/5 rounded-full animate-indeterminate",
            fill,
          )}
        />
      ) : (
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-150",
            fill,
          )}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      )}
    </div>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const MODAL_WIDTHS = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "md",
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    // Return focus to whatever opened the dialog when it closes.
    const opener = document.activeElement;
    const focusable = panel.current?.querySelector<HTMLElement>(
      "[data-autofocus], input, textarea, select",
    );
    (focusable ?? panel.current)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-[3px] animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className={cx(
          "glass-panel flex max-h-full w-full flex-col overflow-hidden rounded-xl border outline-none animate-rise",
          MODAL_WIDTHS[width],
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          <IconButton
            label={t("common:close")}
            icon={X}
            size="sm"
            onClick={onClose}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas/50 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
