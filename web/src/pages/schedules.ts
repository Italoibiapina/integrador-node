export type SchedulesPageDeps = {
  api: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

type ScheduleRow = {
  id: string;
  api_service_id: string;
  cron: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  service_display_name: string;
  service_name?: string | null;
};

type ServiceRow = { id: string; name: string; service_name?: string | null; is_active?: boolean };

export function renderSchedulesPage(deps: SchedulesPageDeps, route: { id?: string | null } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'content';

  root.innerHTML = `
    <h1>Agendamentos</h1>
    <p class="muted">Agendamentos (cron) dos serviços da seção Disparo Manual.</p>

    <div class="card">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div class="actions">
          <button id="btnNew">Novo</button>
          <button id="btnReload">Atualizar</button>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Serviço</th>
            <th>Cron</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="actions" style="justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h2 style="margin: 0; font-size: 16px;">Histórico de Execução</h2>
        <div class="actions">
          <button id="btnReloadHistory">Atualizar</button>
          <a href="#/service-execution-logs">Abrir logs</a>
        </div>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Data/Hora</th>
            <th>Serviço</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="historyRows"></tbody>
      </table>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h2 style="margin: 0 0 10px; font-size: 16px;">Saída</h2>
      <pre id="out"></pre>
    </div>

    <div id="modalBackdrop" class="modal-backdrop" style="display:none;">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modalTitle" style="margin: 0; font-size: 16px;">Agendamento</h2>
          <button id="btnCloseModal" class="modal-close">Fechar</button>
        </div>
        <div class="divider"></div>
        <div class="row">
          <label>
            Serviço
            <select id="serviceId"></select>
          </label>
        </div>
        <div class="divider" style="margin: 12px 0;"></div>
        <div class="row">
          <label>
            Frequência
            <select id="freqType">
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
              <option value="everyMinutes">A cada X minutos</option>
              <option value="everyHours">A cada X horas</option>
              <option value="custom">Cron (avançado)</option>
            </select>
          </label>
          <label>
            Horário
            <input id="timeOfDay" type="time" value="02:00" />
          </label>
        </div>
        <div class="row" id="rowDaily" style="margin-top: 10px;">
          <label>
            A cada quantos dias
            <input id="dailyInterval" type="number" min="1" step="1" value="1" />
          </label>
        </div>
        <div class="row" id="rowWeekly" style="margin-top: 10px; display:none;">
          <label style="flex: 1;">
            Dias da semana
            <div class="row" style="margin-top: 6px; gap: 8px;">
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowMon" />Seg</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowTue" />Ter</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowWed" />Qua</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowThu" />Qui</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowFri" />Sex</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowSat" />Sáb</label>
              <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" id="dowSun" />Dom</label>
            </div>
          </label>
        </div>
        <div class="row" id="rowMonthly" style="margin-top: 10px; display:none;">
          <label>
            Dia do mês
            <input id="monthDay" type="number" min="1" max="31" step="1" value="1" />
          </label>
        </div>
        <div class="row" id="rowEveryMinutes" style="margin-top: 10px; display:none;">
          <label>
            Intervalo (minutos)
            <input id="everyMinutes" type="number" min="1" step="1" value="5" />
          </label>
        </div>
        <div class="row" id="rowEveryHours" style="margin-top: 10px; display:none;">
          <label>
            Intervalo (horas)
            <input id="everyHours" type="number" min="1" step="1" value="1" />
          </label>
        </div>
        <div class="row" style="margin-top: 10px;">
          <label>
            Cron (gerado)
            <input id="cron" placeholder="0 2 * * *" />
          </label>
          <label>
            Habilitado
            <select id="enabled">
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </label>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button id="btnSave">Salvar</button>
          <button id="btnCancel">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  const out = root.querySelector<HTMLPreElement>('#out')!;
  const rowsEl = root.querySelector<HTMLTableSectionElement>('#rows')!;
  const historyRowsEl = root.querySelector<HTMLTableSectionElement>('#historyRows')!;
  const serviceSel = root.querySelector<HTMLSelectElement>('#serviceId')!;
  const freqTypeSel = root.querySelector<HTMLSelectElement>('#freqType')!;
  const timeOfDayEl = root.querySelector<HTMLInputElement>('#timeOfDay')!;
  const dailyIntervalEl = root.querySelector<HTMLInputElement>('#dailyInterval')!;
  const monthDayEl = root.querySelector<HTMLInputElement>('#monthDay')!;
  const everyMinutesEl = root.querySelector<HTMLInputElement>('#everyMinutes')!;
  const everyHoursEl = root.querySelector<HTMLInputElement>('#everyHours')!;
  const rowDaily = root.querySelector<HTMLDivElement>('#rowDaily')!;
  const rowWeekly = root.querySelector<HTMLDivElement>('#rowWeekly')!;
  const rowMonthly = root.querySelector<HTMLDivElement>('#rowMonthly')!;
  const rowEveryMinutes = root.querySelector<HTMLDivElement>('#rowEveryMinutes')!;
  const rowEveryHours = root.querySelector<HTMLDivElement>('#rowEveryHours')!;
  const dowMon = root.querySelector<HTMLInputElement>('#dowMon')!;
  const dowTue = root.querySelector<HTMLInputElement>('#dowTue')!;
  const dowWed = root.querySelector<HTMLInputElement>('#dowWed')!;
  const dowThu = root.querySelector<HTMLInputElement>('#dowThu')!;
  const dowFri = root.querySelector<HTMLInputElement>('#dowFri')!;
  const dowSat = root.querySelector<HTMLInputElement>('#dowSat')!;
  const dowSun = root.querySelector<HTMLInputElement>('#dowSun')!;
  const cronEl = root.querySelector<HTMLInputElement>('#cron')!;
  const enabledSel = root.querySelector<HTMLSelectElement>('#enabled')!;
  const btnSave = root.querySelector<HTMLButtonElement>('#btnSave')!;
  const btnCancel = root.querySelector<HTMLButtonElement>('#btnCancel')!;
  const btnNew = root.querySelector<HTMLButtonElement>('#btnNew')!;
  const modalBackdrop = root.querySelector<HTMLDivElement>('#modalBackdrop')!;
  const modalTitle = root.querySelector<HTMLElement>('#modalTitle')!;
  const btnCloseModal = root.querySelector<HTMLButtonElement>('#btnCloseModal')!;

  function log(value: unknown) {
    const line = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    out.textContent = `${line}\n\n${out.textContent}`;
  }

  let services: ServiceRow[] = [];
  let schedules: ScheduleRow[] = [];

  function resolveBatchServiceName(batch: any): string {
    return (
      batch?.snapshot_config?.service?.name ||
      batch?.service_name ||
      batch?.name ||
      'Serviço'
    );
  }

  function resolveBatchDate(batch: any): Date | null {
    const raw = batch?.started_at || batch?.created_at || batch?.updated_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function statusColor(status: string): string {
    if (status === 'success') return '#52c41a';
    if (status === 'error') return '#ff4d4f';
    return '#faad14';
  }

  function parseTime(value: string): { hour: number; minute: number } | null {
    const m = /^(\d{2}):(\d{2})$/.exec((value ?? '').trim());
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  function normalizeInt(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number(String(value ?? '').trim());
    if (!Number.isFinite(parsed)) return fallback;
    const rounded = Math.floor(parsed);
    if (!Number.isFinite(rounded)) return fallback;
    return Math.max(min, Math.min(max, rounded));
  }

  function weekdaySelection(): number[] {
    const out: number[] = [];
    if (dowSun.checked) out.push(0);
    if (dowMon.checked) out.push(1);
    if (dowTue.checked) out.push(2);
    if (dowWed.checked) out.push(3);
    if (dowThu.checked) out.push(4);
    if (dowFri.checked) out.push(5);
    if (dowSat.checked) out.push(6);
    return out;
  }

  function setWeekdaysFromList(list: number[]) {
    const set = new Set(list);
    dowSun.checked = set.has(0);
    dowMon.checked = set.has(1);
    dowTue.checked = set.has(2);
    dowWed.checked = set.has(3);
    dowThu.checked = set.has(4);
    dowFri.checked = set.has(5);
    dowSat.checked = set.has(6);
  }

  function inferRecurrenceFromCron(cron: string):
    | { mode: 'daily'; time: string; intervalDays: number }
    | { mode: 'weekly'; time: string; days: number[] }
    | { mode: 'monthly'; time: string; day: number }
    | { mode: 'everyMinutes'; intervalMinutes: number }
    | { mode: 'everyHours'; intervalHours: number }
    | { mode: 'custom' } {
    const raw = String(cron ?? '').trim();
    const parts = raw.split(/\s+/g).filter(Boolean);
    if (parts.length !== 5) return { mode: 'custom' };
    const [min, hour, dom, mon, dow] = parts;

    if (min === '*' && hour === '*' && dom === '*' && mon === '*' && /^\*\/\d+$/.test(dow)) {
      const intervalMinutes = normalizeInt(dow.slice(2), 5, 1, 1440);
      return { mode: 'everyMinutes', intervalMinutes };
    }

    if (/^\*\/\d+$/.test(hour) && min === '0' && dom === '*' && mon === '*' && dow === '*') {
      const intervalHours = normalizeInt(hour.slice(2), 1, 1, 24);
      return { mode: 'everyHours', intervalHours };
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
      const hh = normalizeInt(hour, 2, 0, 23);
      const mm = normalizeInt(min, 0, 0, 59);
      return { mode: 'daily', time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, intervalDays: 1 };
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^[0-6](,[0-6])*$/.test(dow ?? '')) {
      const hh = normalizeInt(hour, 2, 0, 23);
      const mm = normalizeInt(min, 0, 0, 59);
      const days = String(dow)
        .split(',')
        .map((x) => normalizeInt(x, -1, 0, 6))
        .filter((x) => x >= 0);
      return { mode: 'weekly', time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, days };
    }

    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
      const hh = normalizeInt(hour, 2, 0, 23);
      const mm = normalizeInt(min, 0, 0, 59);
      const day = normalizeInt(dom, 1, 1, 31);
      return { mode: 'monthly', time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, day };
    }

    if (raw === '*/5 * * * *') return { mode: 'everyMinutes', intervalMinutes: 5 };
    return { mode: 'custom' };
  }

  function buildCronFromUi(): string {
    const mode = String(freqTypeSel.value);
    if (mode === 'custom') return String(cronEl.value ?? '').trim();

    if (mode === 'everyMinutes') {
      const interval = normalizeInt(everyMinutesEl.value, 5, 1, 1440);
      return `*/${interval} * * * *`;
    }

    if (mode === 'everyHours') {
      const interval = normalizeInt(everyHoursEl.value, 1, 1, 24);
      return `0 */${interval} * * *`;
    }

    const time = parseTime(timeOfDayEl.value) ?? { hour: 2, minute: 0 };
    const minute = time.minute;
    const hour = time.hour;

    if (mode === 'monthly') {
      const day = normalizeInt(monthDayEl.value, 1, 1, 31);
      return `${minute} ${hour} ${day} * *`;
    }

    if (mode === 'weekly') {
      const days = weekdaySelection();
      const dow = days.length ? days.join(',') : '1,2,3,4,5';
      return `${minute} ${hour} * * ${dow}`;
    }

    const intervalDays = normalizeInt(dailyIntervalEl.value, 1, 1, 365);
    if (intervalDays !== 1) {
      return `${minute} ${hour} */${intervalDays} * *`;
    }
    return `${minute} ${hour} * * *`;
  }

  function setUiByMode(mode: string) {
    rowDaily.style.display = mode === 'daily' ? '' : 'none';
    rowWeekly.style.display = mode === 'weekly' ? '' : 'none';
    rowMonthly.style.display = mode === 'monthly' ? '' : 'none';
    rowEveryMinutes.style.display = mode === 'everyMinutes' ? '' : 'none';
    rowEveryHours.style.display = mode === 'everyHours' ? '' : 'none';
    timeOfDayEl.disabled = mode === 'everyMinutes' || mode === 'everyHours';
    cronEl.readOnly = mode !== 'custom';
    cronEl.value = buildCronFromUi();
  }

  function isManualService(service: ServiceRow): boolean {
    const sn = String(service.service_name ?? '').trim();
    return (
      sn === 'PowerStockGetOperationsService' ||
      sn === 'DispatcherService' ||
      sn === 'IntegradorOperacoesLojaDoPowerStockService'
    );
  }

  async function loadServices() {
    const all = await deps.api<ServiceRow[]>('/api-integration/services');
    services = all.filter((s) => isManualService(s) && s.is_active !== false);
    const sorted = [...services].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    serviceSel.innerHTML = sorted.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  function serviceName(id: string) {
    return services.find((s) => s.id === id)?.name ?? id;
  }

  function fillFromSchedule(s: ScheduleRow) {
    serviceSel.value = s.api_service_id;
    cronEl.value = s.cron;
    enabledSel.value = s.enabled ? 'true' : 'false';
    const inferred = inferRecurrenceFromCron(s.cron);
    if (inferred.mode === 'daily') {
      freqTypeSel.value = 'daily';
      timeOfDayEl.value = inferred.time;
      dailyIntervalEl.value = String(inferred.intervalDays);
      setWeekdaysFromList([1, 2, 3, 4, 5]);
      monthDayEl.value = '1';
      everyMinutesEl.value = '5';
      everyHoursEl.value = '1';
    } else if (inferred.mode === 'weekly') {
      freqTypeSel.value = 'weekly';
      timeOfDayEl.value = inferred.time;
      setWeekdaysFromList(inferred.days);
      dailyIntervalEl.value = '1';
      monthDayEl.value = '1';
      everyMinutesEl.value = '5';
      everyHoursEl.value = '1';
    } else if (inferred.mode === 'monthly') {
      freqTypeSel.value = 'monthly';
      timeOfDayEl.value = inferred.time;
      monthDayEl.value = String(inferred.day);
      setWeekdaysFromList([1, 2, 3, 4, 5]);
      dailyIntervalEl.value = '1';
      everyMinutesEl.value = '5';
      everyHoursEl.value = '1';
    } else if (inferred.mode === 'everyMinutes') {
      freqTypeSel.value = 'everyMinutes';
      everyMinutesEl.value = String(inferred.intervalMinutes);
      dailyIntervalEl.value = '1';
      monthDayEl.value = '1';
      everyHoursEl.value = '1';
      setWeekdaysFromList([1, 2, 3, 4, 5]);
    } else if (inferred.mode === 'everyHours') {
      freqTypeSel.value = 'everyHours';
      everyHoursEl.value = String(inferred.intervalHours);
      dailyIntervalEl.value = '1';
      monthDayEl.value = '1';
      everyMinutesEl.value = '5';
      setWeekdaysFromList([1, 2, 3, 4, 5]);
    } else {
      freqTypeSel.value = 'custom';
    }
    setUiByMode(freqTypeSel.value);
  }

  let modalMode: 'create' | 'edit' = 'create';

  function openModal(mode: 'create' | 'edit', schedule?: ScheduleRow) {
    modalMode = mode;
    modalTitle.textContent = mode === 'create' ? 'Novo agendamento' : 'Editar agendamento';

    if (mode === 'edit' && schedule) {
      fillFromSchedule(schedule);
      serviceSel.disabled = true;
    } else {
      serviceSel.disabled = false;
      freqTypeSel.value = 'daily';
      timeOfDayEl.value = '02:00';
      dailyIntervalEl.value = '1';
      monthDayEl.value = '1';
      everyMinutesEl.value = '5';
      everyHoursEl.value = '1';
      setWeekdaysFromList([1, 2, 3, 4, 5]);
      enabledSel.value = 'true';
      setUiByMode(freqTypeSel.value);
    }

    modalBackdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function reload() {
    schedules = await deps.api<ScheduleRow[]>('/api-integration/service-schedules');
    rowsEl.innerHTML = schedules
      .map((s) => {
        const status = s.enabled ? 'habilitado' : 'desabilitado';
        return `
          <tr>
            <td>${s.service_display_name || serviceName(s.api_service_id)}</td>
            <td>${s.cron}</td>
            <td>${status}</td>
            <td>
              <div class="actions">
                <button data-action="edit" data-id="${s.id}">Editar</button>
                <button data-action="enable" data-id="${s.id}">Habilitar</button>
                <button data-action="disable" data-id="${s.id}">Desabilitar</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function reloadHistory() {
    try {
      const batches = await deps.api<any[]>('/api-integration/batches?limit=20');
      historyRowsEl.innerHTML = batches
        .map((b) => {
          const date = resolveBatchDate(b);
          const service = resolveBatchServiceName(b);
          const st = String(b?.status ?? '').trim() || '-';
          return `
            <tr>
              <td>${date ? date.toLocaleString() : '-'}</td>
              <td>${service}</td>
              <td>
                <span class="pill" style="color: ${statusColor(st)}">${st}</span>
              </td>
            </tr>
          `;
        })
        .join('');
    } catch (e) {
      log({ ok: false, error: e });
    }
  }

  rowsEl.addEventListener('click', async (ev) => {
    const el = ev.target as HTMLElement;
    const btn = el.closest('button');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if (!action || !id) return;

    const current = schedules.find((s) => s.id === id);
    if (action === 'edit' && current) {
      openModal('edit', current);
      return;
    }

    try {
      if (action === 'enable') {
        const body = await deps.api(`/api-integration/service-schedules/${encodeURIComponent(id)}/enable`, { method: 'POST' });
        log({ ok: true, enabled: body });
      } else if (action === 'disable') {
        const body = await deps.api(`/api-integration/service-schedules/${encodeURIComponent(id)}/disable`, { method: 'POST' });
        log({ ok: true, disabled: body });
      }
      await reload();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnSave.addEventListener('click', async () => {
    try {
      cronEl.value = buildCronFromUi();
      const body = await deps.api('/api-integration/service-schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: serviceSel.value,
          cron: cronEl.value,
          enabled: enabledSel.value === 'true',
        }),
      });
      log({ ok: true, saved: body });
      await reload();
      closeModal();
    } catch (e) {
      log({ ok: false, error: e });
    }
  });

  btnCancel.addEventListener('click', closeModal);
  btnCloseModal.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === modalBackdrop) closeModal();
  });
  btnNew.addEventListener('click', () => openModal('create'));

  root.querySelector<HTMLButtonElement>('#btnReload')?.addEventListener('click', () => void reload());
  root.querySelector<HTMLButtonElement>('#btnReloadHistory')?.addEventListener('click', () => void reloadHistory());

  const onRecurrenceInputChange = () => {
    setUiByMode(freqTypeSel.value);
  };
  freqTypeSel.addEventListener('change', onRecurrenceInputChange);
  timeOfDayEl.addEventListener('change', onRecurrenceInputChange);
  dailyIntervalEl.addEventListener('input', onRecurrenceInputChange);
  monthDayEl.addEventListener('input', onRecurrenceInputChange);
  everyMinutesEl.addEventListener('input', onRecurrenceInputChange);
  everyHoursEl.addEventListener('input', onRecurrenceInputChange);
  dowSun.addEventListener('change', onRecurrenceInputChange);
  dowMon.addEventListener('change', onRecurrenceInputChange);
  dowTue.addEventListener('change', onRecurrenceInputChange);
  dowWed.addEventListener('change', onRecurrenceInputChange);
  dowThu.addEventListener('change', onRecurrenceInputChange);
  dowFri.addEventListener('change', onRecurrenceInputChange);
  dowSat.addEventListener('change', onRecurrenceInputChange);
  cronEl.addEventListener('input', () => {
    if (freqTypeSel.value === 'custom') return;
    cronEl.value = buildCronFromUi();
  });

  void (async () => {
    await loadServices();
    await reload();
    await reloadHistory();
    if (route.id) {
      const s = schedules.find((x) => x.id === route.id);
      if (s) openModal('edit', s);
    }
  })();

  return root;
}
