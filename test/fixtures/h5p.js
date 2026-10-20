/**
 * H5P-Bloecke wie StudOn sie ausliefert: leeres Iframe + Hinweis im Markup, Inhalt base64
 * im Aufruf il.H5P.initContent(...) weiter unten (Aufbau 1:1 aus einer Lernmodulseite,
 * Texte gekuerzt und ersetzt).
 */

const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

export const VIDEO_CID = '188096';
export const VIDEO_URL = `https://www.studon.fau.de/studon/data/StudOn/h5p/content/${VIDEO_CID}/videos/sources-6ad1cde9b144e.mp4`;

export function h5pBlock(elementId, contentId) {
  return `<div style="margin-top: 25px;"><div id="${elementId}" class="h5p-iframe-wrapper">
<div class="alert alert-info" role="status">
	<div class="ilAccHeadingHidden">Informationsmeldung</div>Bitte warten Sie, bis der Inhalt geladen werden konnte.</div>
    <iframe id="h5p-iframe-${contentId}" class="h5p-iframe" data-content-id="${contentId}" style="height: 1px;" src="about:blank" frameborder="0" scrolling="no" allow="microphone"></iframe>
</div></div>`;
}

export function h5pInit(elementId, contentId, { library, title }, params) {
  const integration = { library, fullScreen: false, embedType: 'iframe', title, metadata: { title }, mainId: Number(contentId), url: '' };
  return `<script>il.Util.addOnLoad(function () {
                il.H5P.initContent(
                    '${elementId}',
                    ${contentId},
                    \`${b64(integration)}\`,
                    \`${b64(params)}\`,
                    null
                );
            });</script>`;
}

const col = (...items) => ({ content: items.map((content) => ({ content, useSeparator: 'auto' })) });
const sub = (library, params, title = '') => ({ library, params, metadata: { title } });

export const WELCOME = {
  cid: '187903',
  info: { library: 'H5P.Column 1.18', title: 'herzlich-willkommen-text' },
  params: col(sub('H5P.AdvancedText 1.1', { text: '<h2>Welcome!</h2><p>We’re glad you’re here – über Wertschöpfung.</p>' })),
};

export const VIDEO = {
  cid: VIDEO_CID,
  info: { library: 'H5P.Column 1.18', title: 'welcome-video' },
  params: col(sub('H5P.Video 1.6', {
    l10n: { name: 'Video', loading: 'Videoplayer lädt...' },
    sources: [{ path: 'videos/sources-6ad1cde9b144e.mp4', mime: 'video/mp4' }],
  }, 'Überblick: Kapitel 1')),
};

export const QUIZ = {
  cid: '187999',
  info: { library: 'H5P.QuestionSet 1.20', title: 'self-check' },
  params: {
    introPage: { showIntroPage: false, startButtonText: 'Start Quiz', introduction: '' },
    questions: [
      sub('H5P.DragText 1.10', {
        taskDescription: '<p>Match the features of Netflix to the core element.</p>',
        checkAnswer: 'Check',
        textField: 'Unlimited streaming for a fixed price: *Value Proposition*\nSubscription plans: *Value Capture:Tipp*',
      }),
      sub('H5P.MultiChoice 1.16', {
        UI: { checkAnswerButton: 'Check', tryAgainButton: 'Retry' },
        question: '<p>Why does an innovative product alone not guarantee success?</p>',
        answers: [
          { correct: true, text: '<div>Only the business model determines value capture.</div>' },
          { correct: false, text: '<div>Products are easy to imitate.</div>' },
        ],
      }),
      sub('H5P.TrueFalse 1.8', { correct: 'false', l10n: { trueText: 'True' }, question: '<p>Longer range is a business model innovation.</p>' }),
      sub('H5P.Blanks 1.14', {
        text: '<p>Fill in the missing terms.</p>',
        tipLabel: 'Tip',
        questions: ['<p>Digital firms benefit from low *marginal costs*.</p>', '<p>Advantage rests on *network effects/network effect*.</p>'],
      }),
    ],
  },
};

/** Seite eines Lernmoduls mit den gegebenen H5P-Inhalten (Aufbau wie StudOn). */
export function h5pLmPage(title, contents) {
  const blocks = contents.map((c, i) => h5pBlock(`il_ui_fw_${i}`, c.cid)).join('\n');
  const inits = contents.map((c, i) => h5pInit(`il_ui_fw_${i}`, c.cid, c.info, c.params)).join('\n');
  return `<!DOCTYPE html><html lang="de"><head><title>${title}: StudOn</title></head><body>
  <div id="il_center_col"><div id="ilLMPageContent" class="ilc_page_frame_PageFrame">
    <div class="ilc_page_cont_PageContainer">
      <h1 class="ilc_page_title_PageTitle">${title}</h1>
      <div class="ilc_section_Mnemonicneu ilCOPageSection"><p class="ilc_Paragraph ilc_text_block_Standard"><!--Break--></p>
      ${blocks}
      </div>
      <div class="il-copg-mob-fullscreen-modal"><div class="modal"><div class="modal-body"><iframe class="il-copg-mob-fullscreen"></iframe></div></div></div>
    </div>
  </div></div>
  ${inits}
  </body></html>`;
}

/** Druckauswahl wie StudOn: Lernmodul → Kapitel → Seite, je mit Symbol. */
export function explorerSelection(tree) {
  const icon = { lm: 'icon_lm.svg', st: 'icon_st.svg', pg: 'icon_pg.svg' };
  const node = (n) => `<li class="il_Explorer">
 <input type="checkbox" name="sel_obj_id[]" value="${n.id}" id="sel_obj_id_${n.id}" />
<img src="./Customizing/global/skin/studon9skin/studon9style/images/standard/${icon[n.type]}" alt="" class="ilIcon" /> ${n.title}
${n.children ? `<ul class="il_Explorer">${n.children.map(node).join('')}</ul>` : ''}</li>`;
  return `<div class="modal fade il-modal-roundtrip"><div class="modal-dialog"><form>
<ul class="il_Explorer">${node(tree)}</ul></form></div></div>`;
}
