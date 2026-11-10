// Runs before the dashboard paints: applies the saved theme so dark mode
// never flashes light (components/portal/theme-toggle.tsx).
export const themeScript = `try{if(localStorage.getItem("payrouta-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
