interface Choice {
  label: string
  onClick: () => void
  /** primary 用于推荐操作 */
  variant?: 'primary' | 'default' | 'danger'
}

interface Props {
  title: string
  description?: string
  choices: Choice[]
}

/**
 * 底部弹出的选择面板。手机上比 window.confirm 更清楚：
 * 每个选项是独立按钮，能写清楚「会 / 不会发生什么」。
 */
export function ActionSheet({ title, description, choices }: Props) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <h2 className="sheet-title">{title}</h2>
        {description ? <p className="sheet-desc">{description}</p> : null}
        <div className="sheet-actions">
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.label}
              className={`btn full ${choice.variant === 'primary' ? 'primary' : ''} ${
                choice.variant === 'danger' ? 'danger' : ''
              }`}
              onClick={choice.onClick}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
