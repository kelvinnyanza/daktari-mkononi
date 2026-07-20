/** Money display: whole TZS, "TSh 30,000" — never decimals (see CLAUDE.md). */
export function formatTzs(amountTzs: number): string {
  const digits = Math.trunc(Math.abs(amountTzs)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `TSh ${amountTzs < 0 ? '-' : ''}${grouped}`;
}
