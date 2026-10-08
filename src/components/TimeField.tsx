interface Props {
  /** HH:MM（24 小時制） */
  value: string;
  onChange: (hm: string) => void;
  className?: string;
}

/**
 * 永遠用 24 小時制顯示；點下去開啟系統的時間選擇器。
 * 直接用 <input type="time"> 會依語系顯示「下午 06:00」，在窄欄位會被截掉。
 */
export function TimeField({ value, onChange, className = 'time-input' }: Props) {
  return (
    <label className={`${className} time-field`}>
      <span>{value}</span>
      <input type="time" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}
