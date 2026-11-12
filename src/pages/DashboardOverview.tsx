import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IconPlus, IconCopy, IconQrcode, IconCheck, IconMapPin, IconCircleCheck, IconUsers, IconCalendarOff } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor, countOf } from '@/config/plan';
import type { Umfragen, Terminvorschlaege, Antworten } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { ChartWidget, type ChartRow } from '@/components/widgets/ChartWidget';
import { usePublicPageLink } from '@/components/widgets/PublicPageQr';
import { qrSvgString } from '@/components/widgets/QrCode';

type Filter = 'all' | 'offen' | 'ohnefinal' | 'ohneantwort';

interface SlotStat {
  slot: Terminvorschlaege;
  ja: number;
  vielleicht: number;
  nein: number;
}

interface SurveyCardProps {
  survey: Umfragen;
  slots: SlotStat[];
  participants: number;
  bestId: string | null;
  finalId: string | null;
  onOpen: () => void;
  onOpenSlot: (slot: Terminvorschlaege) => void;
}

function slotLabel(s: Terminvorschlaege): string {
  const loc = { locale: dateFnsLocale() };
  const b = s.fields.beginn ? parseISO(s.fields.beginn) : null;
  const e = s.fields.ende ? parseISO(s.fields.ende) : null;
  if (!b) return '—';
  const day = format(b, 'EEE dd.MM.', loc);
  const from = format(b, 'HH:mm');
  if (!e) return `${day} ${from}`;
  const sameDay = format(b, 'yyyy-MM-dd') === format(e, 'yyyy-MM-dd');
  return sameDay ? `${day} ${from}–${format(e, 'HH:mm')}` : `${day} ${from} – ${format(e, 'EEE dd.MM. HH:mm', loc)}`;
}

function SurveyCard({ survey, slots, participants, bestId, finalId, onOpen, onOpenSlot }: SurveyCardProps) {
  const { link } = usePublicPageLink('umfragen', survey.record_id);
  const isOpen = survey.fields.status?.key !== 'geschlossen';
  const maxJa = Math.max(1, ...slots.map(s => s.ja));

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      undoToast(tx('Link kopiert'));
    } catch {
      window.prompt(tx('Link zum Kopieren'), link);
    }
  };
  const openQr = () => {
    if (!link) return;
    const url = URL.createObjectURL(new Blob([qrSvgString(link, { pixelSize: 8 })], { type: 'image/svg+xml' }));
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="rounded-[27px] bg-card shadow-lg overflow-hidden p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="font-semibold text-base truncate">{survey.fields.titel ?? '—'}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className={isOpen ? 'font-medium text-emerald-600' : 'font-medium text-muted-foreground'}>
              {survey.fields.status?.label ?? ''}
            </span>
            {survey.fields.ort && (
              <span className="inline-flex items-center gap-1 min-w-0"><IconMapPin size={14} className="shrink-0" /><span className="truncate">{survey.fields.ort}</span></span>
            )}
            <span className="inline-flex items-center gap-1"><IconUsers size={14} className="shrink-0" />{countOf('antworten', participants, appLabel('antworten'))}</span>
          </div>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={!link}>
            <IconCopy size={16} className="shrink-0" /> {tx('Link kopieren')}
          </Button>
          <Button size="sm" variant="outline" onClick={openQr} disabled={!link}>
            <IconQrcode size={16} className="shrink-0" /> {tx('QR-Code öffnen')}
          </Button>
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge — füge welche hinzu.')}</p>
      ) : (
        <ul className="space-y-2">
          {slots.map(s => {
            const isFinal = finalId === s.slot.record_id;
            const isBest = isOpen && bestId === s.slot.record_id && s.ja > 0;
            const go = isOpen && s.ja + s.vielleicht > 0 ? flowActionFor('umfragen', 'finaler_termin', survey.record_id, s.slot.record_id) : null;
            return (
              <li
                key={s.slot.record_id}
                className={`rounded-2xl border px-3 py-2.5 ${isFinal ? 'border-emerald-500 bg-emerald-500/10' : isBest ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => onOpenSlot(s.slot)} className="min-w-0 text-left text-sm font-medium">
                    {slotLabel(s.slot)}
                    {isFinal && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600"><IconCircleCheck size={15} />{tx('Finaler Termin')}</span>}
                    {isBest && !isFinal && <span className="ml-2 text-primary">{tx('Meiste Ja')}</span>}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-emerald-600">{tx('Ja')} {s.ja}</span>
                    <span className="font-semibold text-amber-600">{tx('Vielleicht')} {s.vielleicht}</span>
                    <span className="text-muted-foreground">{tx('Nein')} {s.nein}</span>
                    {go && !isFinal && (
                      <Button size="sm" onClick={go}><IconCheck size={16} className="shrink-0" /> {tx('Festlegen & schließen')}</Button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="bg-emerald-500" style={{ width: `${(s.ja / maxJa) * 100}%`, maxWidth: '100%' }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { umfragen, terminvorschlaege, antworten } = data;
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'umfragen') return undefined;
      const s = surveys.find(x => x.survey.record_id === top.record.record_id);
      if (!s || !s.isOpen || !s.bestId) return undefined;
      const go = flowActionFor('umfragen', 'finaler_termin', top.record.record_id, s.bestId);
      return go ? { label: tx('Besten Termin festlegen & schließen'), onClick: go } : undefined;
    },
  });

  const surveys = useMemo(() => {
    const slotsBy = new Map<string, Terminvorschlaege[]>();
    for (const t of terminvorschlaege) {
      const uid = extractRecordId(t.fields.umfrage);
      if (!uid) continue;
      (slotsBy.get(uid) ?? slotsBy.set(uid, []).get(uid)!).push(t);
    }
    const answersBy = new Map<string, Antworten[]>();
    for (const a of antworten) {
      const uid = extractRecordId(a.fields.umfrage);
      if (!uid) continue;
      (answersBy.get(uid) ?? answersBy.set(uid, []).get(uid)!).push(a);
    }
    return umfragen
      .map(survey => {
        const answers = answersBy.get(survey.record_id) ?? [];
        const slots: SlotStat[] = (slotsBy.get(survey.record_id) ?? [])
          .slice()
          .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''))
          .map(slot => {
            const mine = answers.filter(a => extractRecordId(a.fields.terminvorschlag) === slot.record_id);
            const c = (k: string) => mine.filter(a => a.fields.antwort?.key === k).length;
            return { slot, ja: c('ja'), vielleicht: c('vielleicht'), nein: c('nein') };
          });
        const best = slots.reduce<SlotStat | null>((m, s) => (!m || s.ja > m.ja ? s : m), null);
        const people = new Set(answers.map(a => `${a.fields.teilnehmer_vorname ?? ''} ${a.fields.teilnehmer_nachname ?? ''}`.trim().toLowerCase()));
        return {
          survey,
          slots,
          participants: people.size,
          bestId: best && best.ja > 0 ? best.slot.record_id : null,
          finalId: extractRecordId(survey.fields.finaler_termin),
          isOpen: survey.fields.status?.key !== 'geschlossen',
        };
      })
      .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || (b.survey.createdat ?? '').localeCompare(a.survey.createdat ?? ''));
  }, [umfragen, terminvorschlaege, antworten]);

  const open = surveys.filter(s => s.isOpen);
  const noFinal = open.filter(s => !s.finalId);
  const noAnswer = open.filter(s => s.participants === 0);

  const visible = surveys.filter(s =>
    filter === 'offen' ? s.isOpen
      : filter === 'ohnefinal' ? s.isOpen && !s.finalId
        : filter === 'ohneantwort' ? s.isOpen && s.participants === 0
          : true);

  const rows = useMemo<ChartRow<Antworten>[]>(
    () => antworten.map(a => ({ id: `antworten:${a.record_id}`, data: a })),
    [antworten],
  );

  const toggle = (f: Filter) => setFilter(cur => (cur === f ? 'all' : f));

  const context = (() => {
    if (surveys.length === 0) return tx('Lege deine erste Umfrage an und teile den Link.');
    const waiting = noFinal.filter(s => s.participants > 0).map(s => s.survey.fields.titel ?? '');
    if (waiting.length > 0) return tx`${namen(waiting)} wartet auf deine Entscheidung.`;
    const quiet = noAnswer.map(s => s.survey.fields.titel ?? '');
    if (quiet.length > 0) return tx`Bei ${namen(quiet)} gibt es noch keine Antworten — teile den Link.`;
    return tx('Alle Umfragen sind entschieden.');
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>
            <IconPlus size={16} className="shrink-0" /> {tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      <DashboardGrid
        variant="split"
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Offene Umfragen')}
              value={open.length}
              onClick={() => toggle('offen')}
              active={filter === 'offen'}
              tone={open.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Ohne finalen Termin')}
              value={noFinal.length}
              onClick={() => toggle('ohnefinal')}
              active={filter === 'ohnefinal'}
              tone={noFinal.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Ohne Antworten')}
              value={noAnswer.length}
              onClick={() => toggle('ohneantwort')}
              active={filter === 'ohneantwort'}
            />
          </StatStrip>
        }
        aside={
          <ChartWidget<Antworten>
            title={tx('Antworten gesamt')}
            rows={rows}
            dimension={{ kind: 'category', accessor: r => r.data.fields.antwort, label: tx('Antwort') }}
            tone={seg => (seg.key === 'ja' ? 'success' : 'default')}
          />
        }
        primary={
          visible.length === 0 ? (
            <div className="rounded-[27px] bg-card shadow-lg p-8 text-center space-y-3">
              <IconCalendarOff size={48} className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {surveys.length === 0 ? tx('Noch keine Umfrage vorhanden.') : tx('Keine Umfrage in dieser Auswahl.')}
              </p>
              {crud.umfragen.canWrite && surveys.length === 0 && (
                <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })}>{tx('Erste Umfrage anlegen')}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {visible.map(s => (
                <SurveyCard
                  key={s.survey.record_id}
                  survey={s.survey}
                  slots={s.slots}
                  participants={s.participants}
                  bestId={s.bestId}
                  finalId={s.finalId}
                  onOpen={() => crud.umfragen.openDetail(s.survey)}
                  onOpenSlot={slot => crud.terminvorschlaege.openDetail(slot)}
                />
              ))}
            </div>
          )
        }
      />
      {crud.surfaces}
    </div>
  );
}
