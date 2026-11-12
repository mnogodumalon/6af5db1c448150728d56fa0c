/**
 * Umfrage abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offene Umfrage wählen → 2) Finalen Termin aus den Terminvorschlägen wählen → 3) Prüfen & schließen.
 * Reads: umfragen, terminvorschlaege. Writes: umfragen (finaler_termin, status=geschlossen) via useUmfrageAbschliessenFlow.
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { fieldText, fieldDate, fieldRef, fieldLookup } from '@/lib/journey';
import { useUmfrageAbschliessenFlow } from '@/lib/journey/flows/UmfrageAbschliessen';
import { tx } from '@/i18n';

function fmt(iso: string | null): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm');
  } catch {
    return iso;
  }
}

export default function UmfrageAbschliessenPage() {
  const [step, setStep] = useState(1);
  const [umfrageId, setUmfrageId] = useState<string | null>(null);

  const flow = useUmfrageAbschliessenFlow({
    steps: { umfragen: 1, finaler_termin: 2 },
    items: {
      umfragen: r => ({ id: r.id, title: fieldText(r, 'titel'), subtitle: fieldText(r, 'ort') || undefined }),
      finaler_termin: r => {
        const von = fmt(fieldDate(r, 'beginn'));
        const bis = fmt(fieldDate(r, 'ende'));
        return { id: r.id, title: von, subtitle: bis ? tx`bis ${bis}` : undefined };
      },
    },
    where: {
      umfragen: r => fieldLookup(r, 'status')?.key === 'offen',
      finaler_termin: r => umfrageId !== null && fieldRef(r, 'umfrage') === umfrageId,
    },
  });

  const umfragePick = flow.pick('umfragen');

  return (
    <IntentWizardShell
      title={tx('Umfrage abschließen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Wähle den finalen Termin und schließe die Umfrage.'),
        needs: [tx('Eine offene Umfrage mit Terminvorschlägen')],
      }}
    >
      <WizardStep label={tx('Umfrage')} description={tx('Welche offene Umfrage möchtest du schließen?')}>
        <EntitySelectStep
          {...flow.picks.umfragen.select}
          {...umfragePick}
          avatar="none"
          searchPlaceholder={tx('Titel oder Ort …')}
          onSelect={id => {
            setUmfrageId(id);
            umfragePick.onSelect(id);
          }}
        />
      </WizardStep>
      <WizardStep label={tx('Finaler Termin')} description={tx('Welcher Terminvorschlag soll gelten?')}>
        {umfragePick.selectedId ? (
          <EntitySelectStep
            {...flow.picks.finaler_termin.select}
            {...flow.pick('finaler_termin')}
            avatar="none"
            emptyText={tx('Für diese Umfrage gibt es keine Terminvorschläge.')}
          />
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        )}
      </WizardStep>
      <WizardStep label={tx('Prüfen')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            confirmLabel={tx('Umfrage schließen')}
            items={[{ key: 'status', label: tx('Status'), value: tx('Geschlossen') }]}
            whatHappensNext={tx('Die Umfrage wird geschlossen und der gewählte Termin gilt als final.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          undo={flow.undo}
          next={[
            { label: tx('Weitere Umfrage abschließen'), onClick: () => { setUmfrageId(null); flow.reset(); setStep(1); } },
            { label: tx('Umfrage mit Terminen anlegen'), href: '#/intents/umfrage-anlegen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
