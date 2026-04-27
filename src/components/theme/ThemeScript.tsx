import { THEME_STORAGE_KEY, THEME_COOKIE_KEY, THEME_COOKIE_MAX_AGE_SECONDS } from './theme-contract';

export default function ThemeScript() {
  return (
    <script
      id="theme-init"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var storageKey='${THEME_STORAGE_KEY}';var cookieKey='${THEME_COOKIE_KEY}';var readCookie=function(){var parts=document.cookie.split(';');for(var i=0;i<parts.length;i++){var p=parts[i].trim();if(p.indexOf(cookieKey+'=')===0){return decodeURIComponent(p.slice(cookieKey.length+1));}}return null;};var writeCookie=function(value){document.cookie=cookieKey+'='+encodeURIComponent(value)+'; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax';};var pref=readCookie();if(pref!=='light'&&pref!=='dark'&&pref!=='system'){pref=localStorage.getItem(storageKey);if(pref!=='light'&&pref!=='dark'&&pref!=='system'){pref='system';}writeCookie(pref);}localStorage.setItem(storageKey,pref);var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=(pref==='system'?(dark?'dark':'light'):pref);var root=document.documentElement;root.dataset.theme=resolved;root.classList.toggle('dark',resolved==='dark');}catch(e){document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark');}})();`,
      }}
    />
  );
}
