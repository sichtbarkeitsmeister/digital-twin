/**
 * HTML/CSS fixtures for scripts/test-grounding-design.ts (not a test itself): homepages of
 * typical client websites, trimmed to what the design detection reads. No network.
 */

export type DesignFixture = { pageUrl: string; html: string; stylesheets: Record<string, string> };

/** WordPress block theme: theme.json presets, default palette, Inter self-hosted, Montserrat from Google. */
export const WORDPRESS_SITE: DesignFixture = {
  pageUrl: "https://www.tischlerei-holz.example/",
  html: `<!doctype html><html lang="de"><head>
<link rel="stylesheet" id="theme-css" href="/wp-content/themes/holz/style.css?ver=1.2" media="all">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600&display=swap">
<style id="global-styles-inline-css">
:root{--wp--preset--color--black:#000000;--wp--preset--color--white:#ffffff;--wp--preset--color--vivid-red:#cf2e2e;--wp--preset--color--luminous-vivid-amber:#fcb900;--wp--preset--color--base:#fbf8f3;--wp--preset--color--contrast:#2b2522;--wp--preset--color--primary:#8a4b1f;--wp--preset--color--secondary:#3e6b48;--wp--preset--font-family--body:"Inter", sans-serif;--wp--preset--font-family--heading:"Montserrat", sans-serif;}
.has-vivid-red-color{color: var(--wp--preset--color--vivid-red) !important;}
.has-vivid-red-background-color{background-color: var(--wp--preset--color--vivid-red) !important;}
.has-luminous-vivid-amber-color{color: var(--wp--preset--color--luminous-vivid-amber) !important;}
.has-luminous-vivid-amber-background-color{background-color: var(--wp--preset--color--luminous-vivid-amber) !important;}
.has-luminous-vivid-amber-border-color{border-color: var(--wp--preset--color--luminous-vivid-amber) !important;}
body{background-color: var(--wp--preset--color--base);color: var(--wp--preset--color--contrast);font-family: var(--wp--preset--font-family--body);}
:root :where(a:where(:not(.wp-element-button))){color: var(--wp--preset--color--primary);text-decoration: underline;}
:root :where(a:where(:not(.wp-element-button)):hover){color: var(--wp--preset--color--contrast);}
h1, h2, h3, h4, h5, h6{color: var(--wp--preset--color--contrast);font-family: var(--wp--preset--font-family--heading);font-weight: 600;letter-spacing: -0.01em;}
:root :where(.wp-element-button, .wp-block-button__link){background-color: var(--wp--preset--color--primary);color: var(--wp--preset--color--base);}
@media (prefers-color-scheme: dark){body{background-color:#111;color:#eee}}
</style>
</head><body class="home"><main><h1>Tischlerei Holz</h1></main></body></html>`,
  stylesheets: {
    "https://www.tischlerei-holz.example/wp-content/themes/holz/style.css?ver=1.2": `/* Theme Name: Holz */
@font-face{font-family:"Inter";src:url("assets/fonts/inter-v13-latin-regular.woff2") format("woff2"),url("assets/fonts/inter-v13-latin-regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Inter";src:url("assets/fonts/inter-v13-latin-700.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}
.site-header a{color:#ffffff}
footer h3{color:#ffffff}`,
  },
};

/** Elementor site: kit globals, Lato self-hosted by Elementor, Playfair Display from Google. */
export const ELEMENTOR_SITE: DesignFixture = {
  pageUrl: "https://kanzlei-recht.example/",
  html: `<!doctype html><html lang="de"><head>
<link rel="stylesheet" id="elementor-frontend-css" href="https://kanzlei-recht.example/wp-content/plugins/elementor/assets/css/frontend.min.css" media="all">
<link rel="stylesheet" id="elementor-post-7-css" href="https://kanzlei-recht.example/wp-content/uploads/elementor/css/post-7.css?ver=1712" media="all">
<link rel="stylesheet" id="elementor-gf-local-lato-css" href="https://kanzlei-recht.example/wp-content/uploads/elementor/google-fonts/css/lato.css?ver=1712" media="all">
<link rel="stylesheet" id="google-fonts-1-css" href="https://fonts.googleapis.com/css?family=Playfair+Display%3A700&display=swap" media="all">
</head><body class="elementor-kit-7"><main><h1>Kanzlei Recht</h1></main></body></html>`,
  stylesheets: {
    "https://kanzlei-recht.example/wp-content/plugins/elementor/assets/css/frontend.min.css": `.elementor-button{background-color:#69727d;color:#fff}.elementor-button:hover{background-color:#000}`,
    "https://kanzlei-recht.example/wp-content/uploads/elementor/css/post-7.css?ver=1712": `.elementor-kit-7{--e-global-color-primary:#1F3A5F;--e-global-color-secondary:#54595F;--e-global-color-text:#3A3A3A;--e-global-color-accent:#E07A1F;--e-global-typography-primary-font-family:"Playfair Display";--e-global-typography-primary-font-weight:700;--e-global-typography-text-font-family:"Lato";--e-global-typography-text-font-weight:400;color:var( --e-global-color-text );font-family:var( --e-global-typography-text-font-family ), Sans-serif;}.elementor-kit-7 a{color:var( --e-global-color-accent );}.elementor-kit-7 h1, .elementor-kit-7 h2, .elementor-kit-7 h3{color:var( --e-global-color-primary );font-family:var( --e-global-typography-primary-font-family ), Sans-serif;font-weight:var( --e-global-typography-primary-font-weight );}.elementor-kit-7 .elementor-button, .elementor-kit-7 button{background-color:var( --e-global-color-accent );}.elementor-section.elementor-section-boxed > .elementor-container{max-width:1140px;}`,
    "https://kanzlei-recht.example/wp-content/uploads/elementor/google-fonts/css/lato.css?ver=1712": `@font-face{font-family:'Lato';font-style:normal;font-weight:400;font-display:swap;src:url(https://kanzlei-recht.example/wp-content/uploads/elementor/google-fonts/fonts/lato-s6uyw4bmutphjx4wxg.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153;}@font-face{font-family:'Lato';font-style:normal;font-weight:400;font-display:swap;src:url(https://kanzlei-recht.example/wp-content/uploads/elementor/google-fonts/fonts/lato-s6uyw4bmutphjx4wxgh.woff2) format('woff2');unicode-range:U+0100-02AF,U+0304;}@font-face{font-family:'Lato';font-style:normal;font-weight:700;font-display:swap;src:url(https://kanzlei-recht.example/wp-content/uploads/elementor/google-fonts/fonts/lato-s6u9w4bmutphh6uvswipgq.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153;}`,
  },
};

/** Hand-written CSS: Georgia, uppercase headings, a red button, a green cookie button. */
export const PLAIN_CSS_SITE: DesignFixture = {
  pageUrl: "https://www.zahnarzt-muster.example/",
  html: `<!doctype html><html lang="de"><head><link rel="stylesheet" href="/css/main.css"></head><body><main><h1>Zahnarztpraxis</h1></main></body></html>`,
  stylesheets: {
    "https://www.zahnarzt-muster.example/css/main.css": `html{font-size:100%}
body{font-family:Georgia,"Times New Roman",serif;color:#333;background:#fff url(/img/paper.png) repeat;font-size:17px;line-height:1.5}
h1,h2,h3{color:#0b3d91;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
a{color:#0b3d91}
a:hover{color:#c8102e}
.btn,.button{background:#c8102e;color:#fff;border-radius:4px}
.btn:hover{background:#8a0b20}
.contact .btn{background-color:#c8102e}
.cookie-banner .btn{background:#00a000}
.hero h1{color:#ffffff}
.footer a{color:#ffffff}`,
  },
};

/** Bootstrap 5.3: --bs-* variables, a dark theme variant, a purple primary. */
export const BOOTSTRAP_SITE: DesignFixture = {
  pageUrl: "https://www.it-service-nord.example/",
  html: `<!doctype html><html lang="de" data-bs-theme="light"><head><link href="/assets/bootstrap.min.css" rel="stylesheet"><link href="/assets/custom.css" rel="stylesheet"></head><body><main><h1>IT-Service Nord</h1></main></body></html>`,
  stylesheets: {
    "https://www.it-service-nord.example/assets/bootstrap.min.css": `:root,[data-bs-theme=light]{--bs-blue:#0d6efd;--bs-primary:#6f42c1;--bs-primary-rgb:111,66,193;--bs-body-font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","Noto Sans","Liberation Sans",Arial,sans-serif;--bs-body-font-size:1rem;--bs-body-color:#212529;--bs-body-bg:#fff;--bs-secondary-color:rgba(33, 37, 41, 0.75);--bs-heading-color:inherit;--bs-link-color:#6f42c1;--bs-link-color-rgb:111,66,193}[data-bs-theme=dark]{--bs-body-color:#dee2e6;--bs-body-bg:#212529;--bs-link-color:#a98eda}body{margin:0;font-family:var(--bs-body-font-family);font-size:var(--bs-body-font-size);color:var(--bs-body-color);background-color:var(--bs-body-bg)}h1,h2,h3,h4,h5,h6{margin-top:0;font-weight:500;color:var(--bs-heading-color)}a{color:rgba(var(--bs-link-color-rgb),var(--bs-link-opacity,1))}.btn{background-color:var(--bs-btn-bg)}.btn-primary{--bs-btn-bg:#6f42c1}`,
    "https://www.it-service-nord.example/assets/custom.css": `.navbar a{color:#fff}`,
  },
};

/** Fonts only from Google Fonts (link and an @font-face on fonts.gstatic.com). */
export const GOOGLE_FONTS_SITE: DesignFixture = {
  pageUrl: "https://www.cafe-am-markt.example/",
  html: `<!doctype html><html lang="de"><head>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Merriweather:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<style>@font-face{font-family:'Pacifico';src:url(https://fonts.gstatic.com/s/pacifico/v22/FwZY7-Qmy14u9lezJ-6H6Mk.woff2) format('woff2')}.logo{font-family:Pacifico,cursive}</style>
</head><body><main><h1>Café am Markt</h1></main></body></html>`,
  stylesheets: {
    "https://www.cafe-am-markt.example/style.css": `body{font-family:'Open Sans',sans-serif;color:#2d2a26;background:#fffdf8}h1,h2,h3{font-family:Merriweather,Georgia,serif;color:#5b3a29}a{color:#a0522d}.button{background:#a0522d}`,
  },
};

/** Self-hosted @font-face (woff2 on the own domain, a cyrillic subset, a ttf-only face). */
export const SELF_HOSTED_SITE: DesignFixture = {
  pageUrl: "https://www.beispiel-bau.de/",
  html: `<!doctype html><html lang="de"><head><link rel="stylesheet" href="https://www.beispiel-bau.de/assets/fonts.css"><link rel="stylesheet" href="/assets/site.css"></head><body><main><h1>Beispiel Bau</h1></main></body></html>`,
  stylesheets: {
    "https://www.beispiel-bau.de/assets/fonts.css": `@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:400;font-display:swap;src:url("../fonts/source-sans-3-v15-latin-regular.woff2") format("woff2"),url("../fonts/source-sans-3-v15-latin-regular.woff") format("woff")}
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:400;src:url("../fonts/source-sans-3-v15-cyrillic-regular.woff2") format("woff2");unicode-range:U+0301,U+0400-045F}
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/source-sans-3-v15-latin-700.woff2") format("woff2")}
@font-face{font-family:"Bitter";font-style:normal;font-weight:700;src:url("/fonts/bitter-700.woff2") format("woff2")}
@font-face{font-family:"Oldstyle";src:url("/fonts/oldstyle.ttf") format("truetype")}`,
    "https://www.beispiel-bau.de/assets/site.css": `body{font-family:"Source Sans 3",Arial,sans-serif;color:#1d2b36;background-color:#ffffff}h1,h2{font-family:Bitter,Georgia,serif;font-weight:700;color:#0f4c81}h3{font-family:Bitter,serif;color:#0f4c81}a{color:#0f4c81}.btn-primary{background-color:#f2a900}.quote{font-family:Oldstyle,serif}`,
  },
};

/** Light grey text on white, a yellow link: unreadable, so the neutral colours return. */
export const LOW_CONTRAST_SITE: DesignFixture = {
  pageUrl: "https://www.blasse-seite.example/",
  html: `<!doctype html><html lang="de"><head><style>body{color:#b5b5b5;background:#ffffff;font-family:Helvetica,Arial,sans-serif}h1,h2{color:#e0e0e0}a{color:#ffd400}.cta{background:#ffe680}</style></head><body><main><h1>Blasse Seite</h1></main></body></html>`,
  stylesheets: {},
};

/** HTML as the Grounding agent writes it, with everything it must not bring. */
export const AGENT_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Beispiel Bau GmbH: Fakten</title>
<meta name="description" content="Fakten zur Beispiel Bau GmbH in Hamm.">
<link rel="canonical" href="https://www.beispiel-bau.de/grounding/">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">
<link rel="preconnect" href="https://fonts.gstatic.com">
<style>body{font-family:Roboto;color:#123}main{max-width:40rem}</style>
<script>console.log("tracking")</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebPage","@id":"https://www.beispiel-bau.de/grounding/","name":"Beispiel Bau <GmbH>"}
</script>
</head>
<body>
<main>
<h1 style="color:red">Beispiel Bau GmbH</h1>
<p class="lead-definition" onclick="alert(1)">Die Beispiel Bau GmbH ist ein Dachdeckerbetrieb in Hamm.</p>
<p><a href="javascript:alert(1)">Kontakt</a></p>
</main>
</body>
</html>`;
