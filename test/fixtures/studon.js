/**
 * Fixture HTML modelled on real StudOn (ILIAS 9) markup captured in fau-mcp/docs.
 */

export function item({ type, refId, title, size, modified, section }) {
  const props = [];
  if (size) props.push(`<span class="il-item-property-name">Größe</span><span class="il-item-property-value">${size}</span>`);
  if (modified) props.push(`<span class="il-item-property-name">Zeit</span><span class="il-item-property-value">${modified}</span>`);
  return `
  <li class="il-std-item-container"><div class="il-item il-std-item ">
    <div class="media">
      <div class="media-left"><img class="icon custom medium" src="./Customizing/global/skin/studon9skin/studon9style/images/standard/icon_${type}.svg" alt="x" /></div>
      <div class="media-body">
        <h4 class="il-item-title"><a href="https://www.studon.fau.de/studon/go/${type}/${refId}" >${title}</a></h4>
        <div class="il-item-actions l-bar__space-keeper"><div class="dropdown"><button class="btn btn-default dropdown-toggle">…</button>
          <ul class="dropdown-menu"><li><button class="btn btn-link" data-action="ilias.php?baseClass=ilrepositorygui&cmd=download&ref_id=${refId}">Download</button></li></ul></div></div>
        <div class="il-item-description">Beschreibung ${title}</div>
        ${props.length ? `<div class="row il-item-properties"><div class="col-sm-12 il-multi-line-cap-3">${props.join('')}</div></div>` : ''}
      </div>
    </div>
  </div></li>`;
}

export function block(header, itemsHtml) {
  return `
  <div class="ilContainerBlock form-inline">
    <div class="ilHeader ilContainerBlockHeader "><h2>${header}</h2></div>
    <div class="ilContainerItemsContainer "><ul>${itemsHtml}</ul></div>
  </div>`;
}

export function page(title, body) {
  return `<!DOCTYPE html><html lang="de"><head><title>${title}: StudOn</title></head><body class="std">
  <div class="il-mainbar"><a href="https://www.studon.fau.de/studon/ilias.php?baseClass=ilDashboardGUI">Dashboard</a></div>
  <nav class="breadcrumb"><a href="https://www.studon.fau.de/studon/go/root/1">Magazin - Einstiegsseite</a> <a href="https://www.studon.fau.de/studon/go/cat/355">5. Technische Fakultät</a></nav>
  <div id="il_center_col">
    <div class="il-page-content-header"><h1>${title}</h1></div>
    <div class="ilTabs"><a href="ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=999">Info</a></div>
    ${body}
  </div>
  <div class="il-footer"><a href="https://www.studon.fau.de/studon/go/blog/5">Blog</a></div>
  </body></html>`;
}

export const COURSE_REF = '234016';

export const coursePage = page('Human Computer Interaction (SS 2026)', `
  ${block('Vorlesung', [
    item({ type: 'lm', refId: '6815119', title: '01_Introduction_to_HCI' }),
    item({ type: 'file', refId: '7000001', title: 'HCI_SS_2026_00_Orga.pdf', size: '1,20 MB', modified: 'Gestern, 14:11' }),
    item({ type: 'webr', refId: '7000009', title: 'Weiterführende Links' }),
  ].join(''))}
  ${block('Übungen', [
    item({ type: 'fold', refId: '6071389', title: 'Übungsblätter' }),
    item({ type: 'exc', refId: '7000002', title: 'Übung 1: Bedürfnisse' }),
    item({ type: 'sess', refId: '7000003', title: 'Sitzung 1 – Kickoff' }),
  ].join(''))}
  ${block('Sonstiges', [
    item({ type: 'copa', refId: '7000004', title: 'FAQ' }),
    item({ type: 'tst', refId: '7000005', title: 'Probeklausur' }),
    item({ type: 'itgr', refId: '7000006', title: 'Gruppe A' }),
    item({ type: 'frm', refId: '7000007', title: 'Forum' }),
  ].join(''))}
`);

export const folderPage = page('Übungsblätter', `
  <div class="ilContainerItemsContainer"><ul>
    ${item({ type: 'file', refId: '7000010', title: 'Blatt_01.pdf', size: '226,41 KB' })}
    ${item({ type: 'file', refId: '7000011', title: 'Blatt_02 (Lösung)', size: '182 KB' })}
    ${item({ type: 'fold', refId: '7000012', title: 'Alt' })}
  </ul></div>`);

export const nestedFolderPage = page('Alt', `
  <div class="ilContainerItemsContainer"><ul>
    ${item({ type: 'file', refId: '7000013', title: 'Blatt_2024.pdf', size: '99 KB' })}
  </ul></div>`);

export const sessionPage = page('Sitzung 1 – Kickoff', `
  <div class="ilContainerItemsContainer"><ul>
    ${item({ type: 'file', refId: '7000020', title: 'Kickoff_Slides.pdf', size: '3,1 MB' })}
  </ul></div>`);

export const emptyPage = page('Leer', '<div class="ilContainerItemsContainer"><ul></ul></div>');

export const exercisePage = page('Übung 1: Bedürfnisse', `
  <div class="il-panel"><div class="panel-heading"><h2>Aufgabe 1</h2></div>
  <div class="panel-body"><p>Beschreiben Sie den <b>Task-Artifact-Cycle</b>.</p>
  <ul><li>Abgabe bis 12.05.</li></ul>
  <div class="il-item-property-name">Dateien</div>
  <a href="ilias.php?baseClass=ilExerciseHandlerGUI&amp;ref_id=7000002&amp;cmdClass=ilobjexercisegui&amp;cmd=downloadFile&amp;ass_id=55&amp;file=Aufgabenblatt_1.pdf">Aufgabenblatt_1.pdf</a>
  <a href="ilias.php?baseClass=ilExerciseHandlerGUI&amp;ref_id=7000002&amp;cmd=downloadSubmissions&amp;ass_id=55">Eigene Abgaben</a>
  </div></div>`);

export const lmPrintSelection = page('01_Introduction_to_HCI', `
  <form><input type="checkbox" name="sel_obj_id[]" id="sel_1" value="101"><label for="sel_1">Motivation</label>
  <input type="checkbox" name="sel_obj_id[]" id="sel_2" value="102"><label for="sel_2">Definitionen</label>
  <input type="checkbox" name="sel_obj_id[]" id="sel_3" value="101"><label for="sel_3">Duplikat</label></form>`);

export function lmPage(title, extraHtml = '') {
  return page(title, `
    <div class="ilc_page_cont_PageContainer">
      <h1 class="ilc_page_title_PageTitle">${title}</h1>
      <div class="ilc_text_block_Standard"><p>Inhalt von ${title}. HCI verbindet <em>Mensch</em> und Computer.</p></div>
      ${extraHtml}
    </div>
    <div class="ilc_page_bnav_BottomNavigation"><a href="ilias.php?obj_id=999">Weiter</a></div>`);
}

export const lmPage1 = lmPage('Motivation', `
  <a href="ilias.php?baseClass=ilLMPresentationGUI&amp;ref_id=6815119&amp;obj_id=101&amp;cmd=downloadFile&amp;file_id=4711">HCI_SS_2026_01_Introduction_1.pdf (5,15 MB)</a>
  <iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Lecture recording"></iframe>`);

export const lmPage2 = lmPage('Definitionen', `
  <a href="ilias.php?baseClass=ilLMPresentationGUI&amp;ref_id=6815119&amp;obj_id=102&amp;cmd=downloadFile&amp;file_id=4711">HCI_SS_2026_01_Introduction_1.pdf (5,15 MB)</a>
  <table><tr><th>Begriff</th><th>Erklärung</th></tr><tr><td>Usability</td><td>Gebrauchstauglichkeit</td></tr></table>`);

export const contentPage = page('FAQ', `
  <div class="ilc_page_cont_PageContainer"><h2>Wann ist die Klausur?</h2><p>Am 29.09.2026.</p></div>`);

export const weblinksPage = page('Weiterführende Links', `
  <div class="ilContainerItemsContainer"><ul>
    <li class="il-std-item-container"><div class="il-item il-std-item"><div class="media-body">
      <h4 class="il-item-title"><a href="https://www.interaction-design.org/literature" target="_blank">IxDF Literatur</a></h4></div></div></li>
    <li class="il-std-item-container"><div class="il-item il-std-item"><div class="media-body">
      <h4 class="il-item-title"><a href="https://www.youtube.com/watch?v=abc123def45">Don Norman Talk</a></h4></div></div></li>
    <li><a href="ilias.php?baseClass=ilLinkResourceHandlerGUI&amp;ref_id=7000009&amp;cmd=callLink&amp;link_id=3">Versteckter Link</a></li>
  </ul></div>`);

export const infoPage = page('Human Computer Interaction (SS 2026)', `
  <div class="il-infoscreen"><h2>Allgemeine Informationen</h2>
  <p>Diese Vorlesung führt in die Grundlagen der Mensch-Computer-Interaktion ein und behandelt Wahrnehmung, Modelle und Evaluation.</p>
  <table><tr><td>Dozent</td><td>Prof. Example</td></tr></table></div>`);

export const loginPage = `<!DOCTYPE html><html><head><title>Bitte geben Sie Ihren Benutzernamen und Ihr Passwort ein</title></head>
<body><form><input name="username"><input name="password" type="password"></form></body></html>`;

/** Map URL → HTML for the fake fetch. */
export function routes() {
  const app = 'https://www.studon.fau.de/studon';
  return {
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=${COURSE_REF}`]: coursePage,
    [`${app}/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=${COURSE_REF}`]: infoPage,
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=6071389`]: folderPage,
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=7000012`]: nestedFolderPage,
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=7000003`]: sessionPage,
    [`${app}/go/exc/7000002`]: exercisePage,
    [`${app}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=6815119&cmd=showPrintViewSelection`]: lmPrintSelection,
    [`${app}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=6815119&obj_id=101`]: lmPage1,
    [`${app}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=6815119&obj_id=102`]: lmPage2,
    [`${app}/go/copa/7000004`]: contentPage,
    [`${app}/go/webr/7000009`]: weblinksPage,
  };
}

export function fakeFetch(map, { loginFor = [] } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (loginFor.some((u) => url.includes(u))) {
      return { ok: true, status: 200, url: 'https://www.sso.uni-erlangen.de/simplesaml/module.php/core/loginuserpass.php', text: async () => loginPage };
    }
    const html = map[url];
    if (html == null) return { ok: false, status: 404, url, text: async () => 'not found' };
    return { ok: true, status: 200, url, text: async () => html };
  };
  fetch.calls = calls;
  return fetch;
}

/* ---------- Kachelansicht und klassische Listenzeilen ----------
 * Objektgruppen koennen in ILIAS 9 als Kacheln ("Kachelansicht", .il-deck > .il-card)
 * angezeigt werden; aeltere Bloecke rendern als .ilCLI-Listenzeilen. Beide Formen
 * stehen z. B. im HCI-Kurs (ref 6748584) auf derselben Seite. Markup 1:1 aus dem
 * Live-DOM uebernommen (Dropdown-Menues gekuerzt).
 */

export function card({ type, refId, title, description = '' }) {
  return `
  <div class="col-xs-6 col-sm-3 col-md-3 col-lg-2"><div class="il-card thumbnail">
    <div class="il-card-repository-head">
      <div><img class="icon custom medium" src="./Customizing/global/skin/studon9skin/studon9style/images/standard/icon_${type}.svg" alt="Lernmodul ILIAS"></div>
      <div></div>
      <div class="il-card-repository-dropdown"><div class="dropdown"><button class="btn btn-default dropdown-toggle" type="button" aria-label="Aktionen für ${title}"><span class="caret"></span></button>
        <ul class="dropdown-menu"><li><button class="btn btn-link" data-action="ilias.php?baseClass=illmpresentationgui&amp;cmd=infoScreen&amp;ref_id=${refId}">Info</button></li></ul></div></div>
    </div>
    <div class="il-card-image-container"><a href="https://www.studon.fau.de/studon/go/${type}/${refId}"><img src="https://www.studon.fau.de/studon/src/FileDelivery/deliver.php/x" class="img-responsive" alt="Öffnen ${title}"></a></div>
    <div class="card-no-highlight"></div>
    <div class="caption card-title"><a href="https://www.studon.fau.de/studon/go/${type}/${refId}">${title}<span data-list-item-id="lg_div_${refId}_pref_6748584"></span></a></div>
    ${description ? `<div class="caption"><div class="il-multi-line-cap-3">${description}</div></div>` : ''}
  </div></div>`;
}

export function deck(header, cardsHtml) {
  return `
  <div class="ilContainerBlock form-inline">
    <div class="ilHeader ilContainerBlockHeader "><h2>${header}</h2></div>
    <div class="ilContainerItemsContainer "><div class="ilContainerTileRows"><div class="il-deck"><div class="row row-eq-height">${cardsHtml}</div></div></div></div>
  </div>`;
}

export function legacyRow({ type, refId, title, description = '' }) {
  return `
  <div class="ilCLI ilObjListRow"><div class="ilContainerListItemOuter">
    <div class="ilContainerListItemIcon"><img class="ilListItemIcon" src="./Customizing/global/skin/studon9skin/studon9style/images/standard/icon_${type}.svg" alt="x"></div>
    <div class="ilContainerListItemContent"><div class="il_ContainerListItem">
      <div class="il_ContainerItemTitle form-inline"><h3 class="il_ContainerItemTitle"><a class="il_ContainerItemTitle" href="https://www.studon.fau.de/studon/go/${type}/${refId}">${title}</a></h3></div>
      ${description ? `<div class="il_Description">${description}</div>` : ''}
    </div></div>
  </div></div>`;
}

export function legacyBlock(header, rowsHtml) {
  return `
  <div class="ilContainerBlock form-inline">
    <div class="ilHeader ilContainerBlockHeader "><h2>${header}</h2></div>
    <div class="ilContainerItemsContainer ">${rowsHtml}</div>
  </div>`;
}

/** Kurs mit gemischter Darstellung: Listenzeilen + Kachel-Block, wie ref 6748584. */
export const mixedPage = page('Human Computer Interaction (SoSe26)', `
  ${legacyBlock("FAQ's and additive Informations", [
    legacyRow({ type: 'copa', refId: '6815126', title: 'FAQ HCI-Lecture and Exercise', description: 'Frequently asked questions' }),
    legacyRow({ type: 'glo', refId: '6815127', title: 'HCI Glossary' }),
  ].join(''))}
  ${legacyBlock('Discussion, Community and Exercises', [
    legacyRow({ type: 'fold', refId: '6815060', title: 'Discussion Sessions' }),
    legacyRow({ type: 'frm', refId: '6815059', title: 'HCI-Forum' }),
  ].join(''))}
  ${deck('Lecture Content', [
    card({ type: 'lm', refId: '6815140', title: 'Analysis', description: 'Please learn the contents for the discussion session on June 2nd.' }),
    card({ type: 'lm', refId: '6815138', title: 'Evaluation 1', description: 'Please learn the contents for the discussion session on May 19th.' }),
    card({ type: 'lm', refId: '6815119', title: 'Introduction to HCI', description: 'Content for discussion session on April 21st.' }),
  ].join(''))}
`);

/* ---------- Legacy-Zeile mit Eigenschaften, News-Block, Video-Objekte ----------
 * Aus dem Survey ueber 65 Kurse (2026-09-04): Listenzeilen tragen Endung/Groesse/Datum
 * als `.il_ItemProperty`, Titel oft ohne Endung ("Cover Templates" ist ein zip);
 * News-Eintraege verlinken mit ref_id des Kurses; HTML-Lernmodule liefern beim Aufruf
 * direkt ein MP4; das Plugin "Interaktives Video" (xvid) bettet ein lokales MP4 mit
 * il_wac_token ein.
 */

export function legacyRowWithProps({ type, refId, title, props = [], href = null }) {
  const link = href || `https://www.studon.fau.de/studon/ilias.php?baseClass=ilrepositorygui&amp;cmdNode=13a:ry&amp;cmdClass=ilObjFileGUI&amp;cmd=sendfile&amp;ref_id=${refId}`;
  return `
  <div class="ilCLI ilObjListRow"><div class="ilContainerListItemOuter">
    <div class="ilContainerListItemIcon"><img alt="Datei" title="Datei" src="./Customizing/global/skin/studon9skin/studon9style/images/standard/icon_${type}.svg" class="ilListItemIcon"></div>
    <div class="ilContainerListItemContent"><div class="il_ContainerListItem">
      <div class="il_ContainerItemTitle form-inline"><h3 class="il_ContainerItemTitle"><a href="${link}" class="il_ContainerItemTitle">${title}</a></h3></div>
      <div class="ilListItemSection il_Description"></div>
      <div class="ilListItemSection il_ItemProperties">${props.map((p) => `<span class="il_ItemProperty"> ${p}&nbsp;&nbsp;</span>`).join('')}</div>
    </div></div>
  </div></div>`;
}

export function newsBlock(courseRef) {
  return `
  <div class="ilBlock"><div class="ilBlockHeader"><h2>Neuigkeiten</h2></div>
    <div class="il_ContainerListItem"><h3 class="il_ContainerItemTitle"><a class="il_ContainerItemTitle" href="ilias.php?baseClass=ilrepositorygui&amp;cmdNode=13a:r4:a5:pm&amp;cmdClass=ilNewsForContextBlockGUI&amp;cmd=showNews&amp;ref_id=${courseRef}&amp;news_id=1">Es wurde eine Datei hinzugefügt.</a></h3></div>
  </div>`;
}

export const VIDEO_COURSE_REF = '5000443';
export const HTLM_REF = '7020332';
export const XVID_REF = '3524459';
export const HTLM_VIDEO_URL = 'https://www.studon.fau.de/studon/data/StudOn/lm_data/lm_9810384/Vorlesung_Marketing_10.06.2026.mp4';
export const XVID_VIDEO_URL = 'https://www.studon.fau.de/studon/data/StudOn/mobs/mm_4849958/PLB_Logistik_VL1.mp4?il_wac_token=006f1a0e36bb876b';

export const videoCoursePage = page('1.1. Vorlesungsaufzeichnungen', `
  ${legacyRowWithProps({ type: 'htlm', refId: HTLM_REF, title: 'Vorlesung_Marketing_10.06.2026', href: `https://www.studon.fau.de/studon/ilias.php?baseClass=ilHTLMPresentationGUI&amp;ref_id=${HTLM_REF}` })}
  ${legacyRowWithProps({ type: 'xvid', refId: XVID_REF, title: 'Vorlesung 1_1 - Vorstellung und Organisatorisches', href: `https://www.studon.fau.de/studon/ilias.php?baseClass=ilObjPluginDispatchGUI&amp;cmd=forward&amp;ref_id=${XVID_REF}&amp;forwardCmd=showContent` })}
  ${legacyRowWithProps({ type: 'file', refId: '6148564', title: 'Cover Templates', props: ['zip', '1,20 MB', '12. Mär 2026, 10:05'] })}
  ${legacyRowWithProps({ type: 'file', refId: '6148565', title: 'Skript.pdf', props: ['pdf', '450 KB', 'Gestern, 14:11'] })}
  ${newsBlock(VIDEO_COURSE_REF)}
`);

export const xvidPage = page('Vorlesung 1_1 - Vorstellung und Organisatorisches', `
  <div class="ilToolbarContainer"></div>
  <div class="row"><div class="col-md-12">
    <video id="ilInteractiveVideo" class="plyr" controls>
      <source src="./data/StudOn/mobs/mm_4849958/PLB_Logistik_VL1.mp4?il_wac_token=006f1a0e36bb876b" type="video/mp4">
    </video>
    <div class="ilc_text_block_Standard"><p>Einführung in Produktion, Logistik und Beschaffung. Organisatorisches zur Vorlesung, Prüfungsform und Literatur werden in dieser ersten Sitzung ausführlich erläutert.</p></div>
  </div></div>`);

/** Routen des Video-Kurses; das HTML-Lernmodul antwortet mit einem MP4 statt einer Seite. */
export function videoRoutes() {
  const app = 'https://www.studon.fau.de/studon';
  return {
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=${VIDEO_COURSE_REF}`]: videoCoursePage,
    [`${app}/ilias.php?baseClass=ilObjPluginDispatchGUI&cmd=forward&ref_id=${XVID_REF}&forwardCmd=showContent`]: xvidPage,
  };
}

/** fetch, der fuer das HTML-Lernmodul ein 261-MB-MP4 "liefert" (nur Header, Body wird verworfen). */
export function videoFetch(map) {
  const base = fakeFetch(map);
  const app = 'https://www.studon.fau.de/studon';
  const fetch = async (url, init) => {
    if (url === `${app}/ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=${HTLM_REF}`) {
      let cancelled = false;
      return {
        ok: true, status: 200, url: HTLM_VIDEO_URL,
        headers: new Map([['content-type', 'video/mp4'], ['content-length', String(273160896)]]),
        body: { cancel: async () => { cancelled = true; } },
        text: async () => { throw new Error('Body eines 261-MB-Videos darf nicht gelesen werden'); },
        get cancelled() { return cancelled; },
      };
    }
    return base(url, init);
  };
  fetch.calls = base.calls;
  return fetch;
}
