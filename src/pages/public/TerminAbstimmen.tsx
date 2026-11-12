import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PublicShell } from '@/components/PublicShell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/blocks/Field';
import { FieldErrorSummary } from '@/components/blocks/FieldErrorSummary';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import {
  loadPublicPagesConfig,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  useStepForm,
  useJourneySubmit,
  useLiveList,
  fieldText,
  fieldDate,
  fieldRef,
  fieldLookup,
  topOne,
  type JourneyRecord,
  type PlanStep,
} from '@/lib/journey';
import { tx } from '@/i18n';

const ANSWERS = ['ja', 'vielleicht', 'nein'] as const;
type Answer = (typeof ANSWERS)[number];

interface Row {
  key: string;
  vorname: string;
  nachname: string;
  byTermin: Record<string, string>;
}

function answerClass(a: string | undefined): string {
  if (a === 'ja') return 'bg-emerald-100 text-emerald-800';
  if (a === 'vielleicht') return 'bg-amber-100 text-amber-800';
  if (a === 'nein') return 'bg-rose-100 text-rose-800';
  return 'text-muted-foreground';
}

export default function TerminAbstimmen() {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage') ?? '';
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig('termin-abstimmen')
      .then(c => {
        setCfg(c);
        setPage(c?.pages['termin-abstimmen'] ?? null);
      })
      .catch(() => {
        setCfg(null);
        setPage(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);

  const umfragenLive = useLiveList(port, 'umfragen', { intervalMs: 0, enabled: !!port && !!linkedId });
  const termineLive = useLiveList(port, 'terminvorschlaege', { intervalMs: 0, enabled: !!port && !!linkedId });
  const antwortenLive = useLiveList(port, 'antworten', { intervalMs: 30_000, enabled: !!port && !!linkedId });

  const umfrage = useMemo(
    () => umfragenLive.records.find(r => r.id === linkedId) ?? null,
    [umfragenLive.records, linkedId],
  );

  const termine = useMemo(
    () =>
      termineLive.records
        .filter(r => fieldRef(r, 'umfrage') === linkedId)
        .sort((a, b) => (fieldDate(a, 'beginn') ?? '').localeCompare(fieldDate(b, 'beginn') ?? '')),
    [termineLive.records, linkedId],
  );

  const antworten = useMemo(
    () =>
      antwortenLive.records
        .filter(r => fieldRef(r, 'umfrage') === linkedId)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')),
    [antwortenLive.records, linkedId],
  );

  // One row per stored record, keyed by the record id: names are not unique (the same name can
  // come from several devices), so records are never folded by name.
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const r of antworten) {
      const termin = fieldRef(r, 'terminvorschlag');
      const answer = fieldLookup(r, 'antwort')?.key;
      if (!termin || !answer) continue;
      out.push({
        key: r.id,
        vorname: fieldText(r, 'teilnehmer_vorname'),
        nachname: fieldText(r, 'teilnehmer_nachname'),
        byTermin: { [termin]: answer },
      });
    }
    return out;
  }, [antworten]);

  const counts = useMemo(() => {
    const c: Record<string, { ja: number; vielleicht: number }> = {};
    for (const r of antworten) {
      const termin = fieldRef(r, 'terminvorschlag');
      const answer = fieldLookup(r, 'antwort')?.key;
      if (!termin) continue;
      c[termin] ??= { ja: 0, vielleicht: 0 };
      if (answer === 'ja') c[termin].ja += 1;
      if (answer === 'vielleicht') c[termin].vielleicht += 1;
    }
    return c;
  }, [antworten]);

  const top = useMemo(
    () =>
      topOne(
        termine,
        [t => counts[t.id]?.ja ?? 0, t => counts[t.id]?.vielleicht ?? 0],
        t => fieldDate(t, 'beginn'),
      ),
    [termine, counts],
  );

  const nameForm = useStepForm('antworten', {
    fields: ['teilnehmer_vorname', 'teilnehmer_nachname'],
    autoComplete: true,
  });

  const plan: PlanStep[] = useMemo(
    () =>
      termine.map((t, i) => ({
        key: `antwort-${t.id}`,
        entity: 'antworten' as const,
        form: nameForm,
        primary: i === 0,
        values: () => ({ antwort: votes[t.id], umfrage: linkedId, terminvorschlag: t.id }),
      })),
    [termine, nameForm, votes, linkedId],
  );

  const submit = useJourneySubmit(port ?? NO_PORT, plan, {
    draftKey: `termin-abstimmen-${linkedId}`,
    check: async () => {
      if (!port) return null;
      const fresh = await port.get('umfragen', linkedId);
      if (fresh && fieldLookup(fresh, 'status')?.key === 'geschlossen') {
        return tx('Die Umfrage wurde inzwischen geschlossen.');
      }
      return null;
    },
  });

  if (loading || !cfg || !page || !port) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }

  if (!linkedId) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link ist unvollständig. Öffne bitte den Link zur Umfrage noch einmal.')}
        </p>
      </PublicShell>
    );
  }

  const failed = [umfragenLive, termineLive, antwortenLive].find(l => !l.loaded && l.error);
  if (failed) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <LoadProblem onRetry={failed.reload} />
      </PublicShell>
    );
  }
  if (!umfragenLive.loaded || !termineLive.loaded || !antwortenLive.loaded) {
    return <PublicShell loading />;
  }
  if (!umfrage) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link passt zu keiner Umfrage. Scanne bitte den QR-Code noch einmal.')}
        </p>
      </PublicShell>
    );
  }

  const closed = fieldLookup(umfrage, 'status')?.key === 'geschlossen';
  const finalId = fieldRef(umfrage, 'finaler_termin');
  const finalTermin = finalId ? termine.find(t => t.id === finalId) ?? null : null;
  const beschreibung = fieldText(umfrage, 'beschreibung');
  const ort = fieldText(umfrage, 'ort');

  const labelFor = (a: string): string =>
    a === 'ja' ? tx('Ja') : a === 'vielleicht' ? tx('Vielleicht') : tx('Nein');
  const markFor = (a: string): string => (a === 'ja' ? '✓' : a === 'vielleicht' ? '?' : '✗');

  const send = async () => {
    setNotice(null);
    setSaved(false);
    const okName = nameForm.validate();
    if (!okName) return;
    if (termine.some(t => !votes[t.id])) {
      setNotice(tx('Bitte wähle bei jedem Termin Ja, Vielleicht oder Nein.'));
      return;
    }
    const res = await submit.run();
    if (res) {
      await antwortenLive.reload();
      nameForm.reset();
      setVotes({});
      submit.reset();
      setSaved(true);
    }
  };

  return (
    <PublicShell title={umfrage ? fieldText(umfrage, 'titel') : tx('Termin abstimmen')} wide>
      <div className="space-y-5">
        {(beschreibung || ort) && (
          <div className="space-y-1 text-sm text-muted-foreground">
            {beschreibung && <p>{beschreibung}</p>}
            {ort && <p>{tx('Ort')}: {ort}</p>}
          </div>
        )}

        {closed && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">{tx('Die Abstimmung ist beendet.')}</p>
            <p>
              {finalTermin
                ? tx`Finaler Termin: ${fieldText(finalTermin, 'beginn')}`
                : tx('Der finale Termin steht noch nicht fest.')}
            </p>
          </div>
        )}

        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx('Für diese Umfrage gibt es noch keine Termine.')}</p>
        ) : (
          <>
            {!closed && (
              <div className="space-y-3 rounded-xl border p-4">
                <p className="text-sm font-medium">{tx('Dein Name')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field form={nameForm} name="teilnehmer_vorname">
                    <Input {...nameForm.field('teilnehmer_vorname')} className="min-h-11" />
                  </Field>
                  <Field form={nameForm} name="teilnehmer_nachname">
                    <Input {...nameForm.field('teilnehmer_nachname')} className="min-h-11" />
                  </Field>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-left font-medium">
                      {tx('Name')}
                    </th>
                    {termine.map(t => {
                      const isTop = !closed && top?.id === t.id;
                      const isFinal = finalTermin?.id === t.id;
                      return (
                        <th
                          key={t.id}
                          className={`min-w-24 p-2 text-center align-top font-medium ${
                            isFinal || isTop ? 'bg-emerald-100 text-emerald-900' : ''
                          }`}
                        >
                          <div>{fieldText(t, 'beginn')}</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {tx('bis')} {fieldText(t, 'ende')}
                          </div>
                          {isFinal && <div className="text-xs">{tx('Finaler Termin')}</div>}
                          {isTop && <div className="text-xs">{tx('Beliebtester Termin')}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.key} className="border-t">
                      <td className="sticky left-0 z-10 max-w-[40vw] truncate bg-background p-2">
                        {row.vorname} {row.nachname}
                      </td>
                      {termine.map(t => {
                        const a = row.byTermin[t.id];
                        return (
                          <td key={t.id} className="p-1 text-center">
                            <span className={`inline-block min-w-16 rounded-md px-2 py-1 ${answerClass(a)}`}>
                              {a ? `${markFor(a)} ${labelFor(a)}` : '–'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!closed && (
                    <tr className="border-t bg-muted/30">
                      <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 font-medium">{tx('Du')}</td>
                      {termine.map(t => (
                        <td key={t.id} className="p-1 align-top">
                          <div role="radiogroup" aria-label={fieldText(t, 'beginn')} className="flex flex-col gap-1">
                            {ANSWERS.map((a: Answer) => (
                              <button
                                key={a}
                                type="button"
                                role="radio"
                                className="min-h-11 min-w-11 rounded-md border bg-background px-2 text-sm aria-checked:border-foreground aria-checked:bg-primary aria-checked:font-semibold aria-checked:text-primary-foreground"
                                aria-checked={votes[t.id] === a}
                                onClick={() => setVotes(v => ({ ...v, [t.id]: a }))}
                              >
                                {markFor(a)} {labelFor(a)}
                              </button>
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td className="sticky left-0 z-10 max-w-[40vw] bg-muted p-2 text-xs text-muted-foreground">
                      {tx('Summe')}
                    </td>
                    {termine.map(t => (
                      <td key={t.id} className="p-2 text-center text-xs">
                        <div className="font-semibold">{tx`${counts[t.id]?.ja ?? 0} Ja`}</div>
                        <div className="text-muted-foreground">{tx`${counts[t.id]?.vielleicht ?? 0} Vielleicht`}</div>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {!closed && (
              <div className="space-y-3">
                <FieldErrorSummary forms={[nameForm]} />
                {notice && <p className="text-sm text-destructive">{notice}</p>}
                {submit.offline && (
                  <p className="text-sm text-muted-foreground">
                    {tx('Keine Verbindung — deine Eingaben sind gesichert.')}
                  </p>
                )}
                {submit.error && !submit.offline && (
                  <p className="text-sm text-destructive">{submit.error.message}</p>
                )}
                {saved && (
                  <p className="text-sm font-medium text-emerald-700">{tx('Danke! Deine Antworten sind gespeichert.')}</p>
                )}
                <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={submit.submitting} onClick={send}>
                  {submit.submitting ? tx('Wird gespeichert …') : tx('Antworten speichern')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}

// useJourneySubmit needs a port before the config has loaded; this one is never used to write.
const NO_PORT = {
  door: 'public',
  list: async () => [],
  count: async () => null,
  get: async () => null,
  create: async () => {
    throw new Error(tx('not ready'));
  },
  ref: (_appId: string, recordId: string) => recordId,
} as const;

export type { JourneyRecord };
