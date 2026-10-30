/* ============================================================
   ASMA Lines — защищённый документ по рейсу (order-doc.html).

   Вынесено из inline <script>, чтобы можно было включить строгий
   Content-Security-Policy без 'unsafe-inline'.
   ============================================================ */
function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    (async function initProtectedDocViewer() {
      'use strict';

      const loadingEl = document.getElementById('doc-loading-screen');
      const gateEl = document.getElementById('doc-access-gate');
      const protectedArea = document.getElementById('doc-protected-area');

      // Extract Telegram Auth token and signed ticket
      const tgInitData = window.Telegram?.WebApp?.initData || sessionStorage.getItem('asma_crm_tg_init_data') || '';
      const params = new URLSearchParams(window.location.search);
      const leadId = params.get('id') || '';
      const leadNum = params.get('lead') || params.get('leadNumber') || '';
      const ticket = params.get('ticket') || params.get('t') || sessionStorage.getItem('asma_active_doc_ticket') || '';

      let verifiedLead = null;
      let verifiedOperator = { name: '', username: '' };
      // Почему не открылось: 'expired' (ссылка старая), 'denied' (нет доступа),
      // 'offline' (сервер не ответил) — тексты на экране блокировки разные.
      let verificationError = '';

      // 1. Authenticate with backend /api/crm/doc-data
      try {
        const res = await fetch('/api/crm/doc-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': tgInitData
          },
          body: JSON.stringify({ leadId, leadNum, ticket })
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.lead) {
            verifiedLead = json.lead;
            if (json.operator) verifiedOperator = json.operator;
          } else {
            verificationError = 'denied';
          }
        } else {
          verificationError = res.status === 403 ? 'expired' : 'denied';
        }
      } catch (err) {
        verificationError = 'offline';
        console.warn('Backend doc verification note:', err);
      }

      // Документ показывается только после серверной проверки короткоживущего ticket.

      // Данные не подтверждены — показываем экран «документ защищён».
      // Раньше здесь подставлялся вымышленный документ, и страница выглядела
      // открытой для любого, кто угадал адрес.
      if (!verifiedLead) {
        loadingEl.style.display = 'none';
        if (gateEl) {
          const titleEl = gateEl.querySelector('.access-gate-title');
          const descEl = gateEl.querySelector('.access-gate-desc');
          if (titleEl && descEl && verificationError === 'expired') {
            titleEl.textContent = 'Ссылка устарела';
            descEl.textContent = 'Ссылка на документ действует два часа. Откройте заявку в диспетчерской и нажмите «Договор-заявка» ещё раз — придёт новая ссылка.';
          } else if (titleEl && descEl && verificationError === 'offline') {
            titleEl.textContent = 'Нет связи с сервером';
            descEl.textContent = 'Не удалось проверить доступ: сервер не ответил. Обновите страницу или откройте документ из диспетчерской.';
          }
          gateEl.style.display = 'flex';
        }
        return;
      }

      // Access Granted! Render Document
      loadingEl.style.display = 'none';
      if (gateEl) gateEl.style.display = 'none';
      protectedArea.style.display = 'block';

      // 2. Resolve Parameters
      const clientName = verifiedLead.company || verifiedLead.name || 'Не указано';
      const contact = verifiedLead.contact || 'Не указан';
      const rawRoute = verifiedLead.route || '';

      let fromCity = '';
      let toCity = '';
      if (rawRoute.includes('→')) {
        const parts = rawRoute.split('→');
        fromCity = parts[0].trim();
        toCity = parts[1].trim();
      } else if (rawRoute.includes('-') && !rawRoute.includes('–')) {
        const parts = rawRoute.split('-');
        fromCity = parts[0].trim();
        toCity = parts[1].trim();
      } else if (rawRoute) {
        fromCity = rawRoute;
      }

      fromCity = fromCity || verifiedLead.fromCity || '';
      toCity = toCity || verifiedLead.toCity || '';
      const distance = verifiedLead.distance || (verifiedLead.distanceKm ? `${verifiedLead.distanceKm} км` : 'Требует уточнения');
      const weight = verifiedLead.weight || (verifiedLead.weightTons ? `${verifiedLead.weightTons} т` : 'Требует уточнения');
      const vehicle = verifiedLead.vehicle || 'Требует подтверждения';
      const numericPrice = Number(verifiedLead.priceValue);
      const price = verifiedLead.price || (Number.isFinite(numericPrice) && numericPrice > 0 ? `${numericPrice.toLocaleString('ru-RU')} BYN` : 'Требует расчёта');
      const comment = verifiedLead.comment || 'Дополнительные условия не указаны.';
      const dispatcher = verifiedOperator.name || verifiedLead.dispatcher || 'Не назначен';

      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      const docCode = `ASMA-${d.getFullYear()}-${verifiedLead.leadNumber || leadNum || 'черновик'}`;

      document.getElementById('doc-date-header').textContent = `Дата: ${dateStr}`;

      let isEditMode = false;

      window.setDocType = function(type) {
        document.querySelectorAll('.doc-tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`tab-${type}`);
        if (btn) btn.classList.add('active');

        if (type === 'order') {
          document.getElementById('doc-num-header').textContent = `ПРОЕКТ ДОГОВОРА-ЗАЯВКИ № ${docCode}`;
          renderOrderTemplate();
        } else if (type === 'kp') {
          document.getElementById('doc-num-header').textContent = `ПРОЕКТ КП № ${docCode}`;
          renderKPTemplate();
        } else if (type === 'waybill') {
          document.getElementById('doc-num-header').textContent = `МАРШРУТНОЕ ПОРУЧЕНИЕ № ${docCode}`;
          renderWaybillTemplate();
        }

        applyEditMode();
      };

      window.toggleEditMode = function() {
        isEditMode = !isEditMode;
        const btn = document.getElementById('btn-toggle-edit');
        if (isEditMode) {
          btn.innerHTML = '<span>💾 Готово</span>';
          btn.classList.add('btn-action-edit-active');
          document.body.classList.add('edit-active');
        } else {
          btn.innerHTML = '<span>✏️ Редактировать</span>';
          btn.classList.remove('btn-action-edit-active');
          document.body.classList.remove('edit-active');
        }
        applyEditMode();
      };

      function applyEditMode() {
        document.querySelectorAll('.paper-sheet [contenteditable]').forEach(el => {
          el.setAttribute('contenteditable', isEditMode ? 'true' : 'false');
        });
      }

      window.copyDocumentToClipboard = function() {
        const text = document.getElementById('doc-canvas').innerText;
        const done = () => alert('✓ Текст документа скопирован в буфер обмена');
        // Clipboard API может быть недоступен (нет разрешения или страница
        // открыта не по HTTPS) — тогда копируем через временную область.
        const fallback = () => {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', 'readonly');
          area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
          document.body.append(area);
          area.select();
          let copied = false;
          try {
            copied = document.execCommand('copy');
          } catch (error) {
            copied = false;
          }
          area.remove();
          alert(copied ? '✓ Текст документа скопирован в буфер обмена' : 'Не удалось скопировать — выделите текст вручную');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback);
        } else {
          fallback();
        }
      };

      // ----------------------------------------------------
      // TEMPLATE 1: ДОГОВОР-ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА
      // ----------------------------------------------------
      function renderOrderTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>ПРОЕКТ ДОГОВОРА-ЗАЯВКИ НА ОРГАНИЗАЦИЮ ПЕРЕВОЗКИ № ${escapeHtml(docCode)}</h1>
            <p>Черновик для согласования сторонами. Перед подписанием проверьте реквизиты, цену и договорные условия.</p>
          </div>

          <div class="parties-grid">
            <div class="party-box">
              <div class="party-box-title">ЭКСПЕДИТОР / ОРГАНИЗАТОР:</div>
              <div class="party-row"><b>ASMA Lines — организатор перевозки</b></div>
              <div class="party-row">Юридическое наименование и реквизиты: заполнить после подтверждения данных стороны</div>
              <div class="party-row">Ответственный: <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="party-row">Контакты: +375 (29) 600-00-00 · hello@asmalines.by</div>
            </div>

            <div class="party-box">
              <div class="party-box-title">ЗАКАЗЧИК:</div>
              <div class="party-row">Организация / ФИО: <b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div class="party-row">Контактный телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="party-row">УНП Заказчика: <span contenteditable="false">Уточняется при выставлении счёта</span></div>
              <div class="party-row">Плательщик и способ оплаты: <span contenteditable="false">Согласовать отдельно</span></div>
            </div>
          </div>

          <table class="spec-table">
            <tbody>
              <tr>
                <th>1. Маршрут перевозки:</th>
                <td><b style="color:#6B1E2D;" contenteditable="false">${escapeHtml(fromCity || 'Уточнить отправление')} ➔ ${escapeHtml(toCity || 'Уточнить назначение')}</b> (расстояние: <span contenteditable="false">${escapeHtml(distance)}</span>)</td>
              </tr>
              <tr>
                <th>2. Адрес и дата погрузки:</th>
                <td><span contenteditable="false">Точный адрес, дата и интервал подачи: согласовать отдельно. Предварительная дата формирования: ${escapeHtml(dateStr)}</span></td>
              </tr>
              <tr>
                <th>3. Адрес и дата выгрузки:</th>
                <td><span contenteditable="false">Точный адрес и интервал выгрузки: согласовать отдельно.</span></td>
              </tr>
              <tr>
                <th>4. Характеристики груза:</th>
                <td>Вес: <b contenteditable="false">${escapeHtml(weight)}</b> · Упаковка / число грузовых мест: <span contenteditable="false">Уточнить</span></td>
              </tr>
              <tr>
                <th>5. Подвижной состав:</th>
                <td><span contenteditable="false">${escapeHtml(vehicle)}</span> · Способ загрузки: <span contenteditable="false">Уточнить</span></td>
              </tr>
              <tr>
                <th>6. Стоимость услуг (Ставка):</th>
                <td class="spec-price-highlight"><span contenteditable="false">${escapeHtml(price)}</span></td>
              </tr>
              <tr>
                <th>7. Порядок расчётов:</th>
                <td><span contenteditable="false">Порядок, сроки и основание оплаты, а также состав документов согласовать отдельно до подписания.</span></td>
              </tr>
              <tr>
                <th>8. Дополнительные условия:</th>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="legal-terms">
            <h4>УСЛОВИЯ, ПОДЛЕЖАЩИЕ СОГЛАСОВАНИЮ</h4>
            <ol>
              <li>Стороны согласуют обязанности организатора перевозки, перевозчика и заказчика в окончательном тексте документа.</li>
              <li>Точные адреса, дата и интервалы погрузки/выгрузки подтверждаются до организации подачи транспорта.</li>
              <li>Порядок оплаты, стоимость дополнительных работ и условия простоя указываются только после согласования сторонами.</li>
              <li>Перечень сопроводительных документов определяется видом и условиями конкретной перевозки.</li>
              <li>Этот шаблон является проектом и не заменяет проверку реквизитов и условий перед подписанием.</li>
            </ol>
          </div>

          <div class="signatures-grid">
            <div class="sign-card">
              <div class="sign-card-title">ЭКСПЕДИТОР:</div>
              <div><b>ASMA Lines — организатор перевозки</b></div>
              <div>Диспетчер: <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
              <div class="sign-seal-label">М.П.</div>
            </div>

            <div class="sign-card">
              <div class="sign-card-title">ЗАКАЗЧИК:</div>
              <div><b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div>Телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
              <div class="sign-seal-label">М.П.</div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------
      // TEMPLATE 2: КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ (КП)
      // ----------------------------------------------------
      function renderKPTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>ИНДИВИДУАЛЬНОЕ КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h1>
            <p>Расчёт стоимости и условия организации автоперевозки по территории Республики Беларусь</p>
          </div>

          <div class="parties-grid">
            <div class="party-box">
              <div class="party-box-title">ИСПОЛНИТЕЛЬ:</div>
              <div class="party-row"><b>ASMA Lines</b> · организация перевозки</div>
              <div class="party-row">Телефон: +375 (29) 600-00-00</div>
              <div class="party-row">E-mail: hello@asmalines.by</div>
              <div class="party-row">Юридические реквизиты стороны подлежат заполнению и проверке.</div>
            </div>

            <div class="party-box">
              <div class="party-box-title">КОМУ:</div>
              <div class="party-row">Клиент: <b contenteditable="false">${escapeHtml(clientName)}</b></div>
              <div class="party-row">Телефон: <span contenteditable="false">${escapeHtml(contact)}</span></div>
              <div class="party-row">Срок действия ставки: <b>согласовать отдельно</b></div>
            </div>
          </div>

          <table class="kp-calc-table">
            <thead>
              <tr>
                <th>Наименование статьи расходов</th>
                <th>Параметры рейса</th>
                <th class="tar">Сумма (BYN)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Подача автомобиля и экспедирование</b></td>
                <td>Состав и стоимость согласуются</td>
                <td class="tar">—</td>
              </tr>
              <tr>
                <td><b>Пробег по автодорожному маршруту</b></td>
                <td><span contenteditable="false">${escapeHtml(fromCity || 'Уточнить отправление')} ➔ ${escapeHtml(toCity || 'Уточнить назначение')} (${escapeHtml(distance)})</span></td>
                <td class="tar">—</td>
              </tr>
              <tr>
                <td><b>Массово-габаритные параметры</b></td>
                <td>Вес: <span contenteditable="false">${escapeHtml(weight)}</span> · Транспорт: <span contenteditable="false">${escapeHtml(vehicle)}</span></td>
                <td class="tar">—</td>
              </tr>
              <tr>
                <td><b>Специальные условия рейса</b></td>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
                <td class="tar">Уточнить</td>
              </tr>
              <tr class="kp-total-highlight">
                <td colspan="2">ИТОГОВАЯ СТАВКА ЗА РЕЙС:</td>
                <td class="tar"><span contenteditable="false">${escapeHtml(price)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="kp-features-grid">
            <div class="kp-feat-card">
              <div class="kp-feat-icon">⚡</div>
              <div class="kp-feat-title">Подбор транспорта</div>
              <div class="kp-feat-desc">Тип и доступность транспорта подтверждаются после уточнения параметров груза.</div>
            </div>
            <div class="kp-feat-card">
              <div class="kp-feat-icon">🤝</div>
              <div class="kp-feat-title">Координация заявки</div>
              <div class="kp-feat-desc">Согласование участников, маршрута и условий перевозки.</div>
            </div>
            <div class="kp-feat-card">
              <div class="kp-feat-icon">📑</div>
              <div class="kp-feat-title">Документы</div>
              <div class="kp-feat-desc">Комплект и способ обмена документами определяются условиями перевозки.</div>
            </div>
          </div>

          <div class="signatures-grid" style="margin-top: 10px;">
            <div class="sign-card" style="grid-column: 1 / -1; max-width: 460px; margin-left: auto;">
              <div class="sign-card-title">ОТВЕТСТВЕННЫЙ СПЕЦИАЛИСТ ПО ЛОГИСТИКЕ:</div>
              <div>ASMA Lines · <span contenteditable="false">${escapeHtml(dispatcher)}</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------
      // TEMPLATE 3: МАРШРУТНОЕ ПОРУЧЕНИЕ ВОДИТЕЛЮ И СКЛАДУ
      // ----------------------------------------------------
      function renderWaybillTemplate() {
        const container = document.getElementById('doc-content-body');
        container.innerHTML = `
          <div class="doc-title-centered">
            <h1>СЛУЖЕБНОЕ МАРШРУТНОЕ ПОРУЧЕНИЕ № ${escapeHtml(docCode)}</h1>
            <p>Задание водителю-экспедитору и складам на выполнение рейса</p>
          </div>

          <div class="waybill-route-banner">
            <div>
              <span style="font-size:11px;text-transform:uppercase;color:#A8A29E;">Маршрут перевозки:</span>
              <div class="waybill-route-title" contenteditable="false">${escapeHtml(fromCity || 'Уточнить отправление')} ➔ ${escapeHtml(toCity || 'Уточнить назначение')}</div>
            </div>
            <div class="waybill-route-meta" contenteditable="false">Расстояние: ${escapeHtml(distance)} · Ставка: ${escapeHtml(price)}</div>
          </div>

          <table class="spec-table">
            <tbody>
              <tr>
                <th>Грузоотправитель (Погрузка):</th>
                <td><b contenteditable="false">${escapeHtml(clientName)}</b> (тел: <span contenteditable="false">${escapeHtml(contact)}</span>)</td>
              </tr>
              <tr>
                <th>Адрес склада погрузки:</th>
                <td><span contenteditable="false">Адрес и время подачи: согласовать отдельно.</span></td>
              </tr>
              <tr>
                <th>Грузополучатель (Выгрузка):</th>
                <td><span contenteditable="false">Адрес и время прибытия: согласовать отдельно.</span></td>
              </tr>
              <tr>
                <th>Параметры груза:</th>
                <td>Вес: <b contenteditable="false">${escapeHtml(weight)}</b> · Транспорт: <span contenteditable="false">${escapeHtml(vehicle)}</span></td>
              </tr>
              <tr>
                <th>Назначенный водитель / Авто:</th>
                <td><span contenteditable="false">Назначается диспетчером (Гос. номер: ______________, тел: ______________)</span></td>
              </tr>
              <tr>
                <th>Инструкции и комментарии:</th>
                <td><span contenteditable="false">${escapeHtml(comment)}</span></td>
              </tr>
            </tbody>
          </table>

          <div class="waybill-check-grid">
            <div class="waybill-check-card">
              <h4>ОТМЕТКА О ПОГРУЗКЕ:</h4>
              <div>Дата и время прибытия: ________________</div>
              <div>Дата и время убытия: __________________</div>
              <div>Количество мест: ______ Штамп/Подпись: ______</div>
            </div>

            <div class="waybill-check-card">
              <h4>ОТМЕТКА О ВЫГРУЗКЕ:</h4>
              <div>Дата и время прибытия: ________________</div>
              <div>Дата и время убытия: __________________</div>
              <div>Претензии по грузу: [ ] Нет  [ ] Есть</div>
            </div>
          </div>

          <div class="signatures-grid">
            <div class="sign-card">
              <div class="sign-card-title">ДИСПЕТЧЕР-ОРГАНИЗАТОР:</div>
              <div><b>${escapeHtml(dispatcher)}</b> · +375 (29) 600-00-00</div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>

            <div class="sign-card">
              <div class="sign-card-title">ВОДИТЕЛЬ ПРИНЯВШИЙ РЕЙС:</div>
              <div><span contenteditable="false">ФИО водителя: ___________________________</span></div>
              <div class="sign-line-wrapper">
                <span>Подпись:</span>
                <div class="sign-underline"></div>
              </div>
            </div>
          </div>
        `;
      }

      // ----------------------------------------------------
      // ПАНЕЛЬ И ВКЛАДКИ
      // ----------------------------------------------------

      /* Кнопки панели и переключатели документов. Без этого блока разметка
         была, а клики по ней не делали ничего: функции существовали, но
         никто их не вызывал. */
      document.querySelectorAll('.doc-tab-btn').forEach((button) => {
        button.addEventListener('click', () => window.setDocType(button.dataset.docType));
      });

      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'print') window.print();
          else if (action === 'copy-document') window.copyDocumentToClipboard();
          else if (action === 'toggle-edit-mode') window.toggleEditMode();
        });
      });

      // Initial Render
      window.setDocType('order');
    })();
