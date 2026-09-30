import { useStore } from '../lib/store-context'

export function ToastHost() {
  const { toasts, dismissToast } = useStore()
  if (toasts.length === 0) return null
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <a className="toast-action" href={toast.action.href} target="_blank" rel="noreferrer">
              {toast.action.label}
            </a>
          )}
          <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
