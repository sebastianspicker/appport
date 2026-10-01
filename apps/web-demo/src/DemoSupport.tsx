import type { copyForBrowser } from "./copy";

export function DemoSupport({
  copy,
}: {
  copy: ReturnType<typeof copyForBrowser>;
}) {
  return (
    <section className="support-panel" id="support">
      <details>
        <summary className="support-summary">
          <span>
            <strong>{copy.support}</strong>
            <span>{copy.supportText}</span>
          </span>
        </summary>
        <dl className="support-details">
          <Detail label={copy.supportUser} value="Demo User" />
          <Detail label={copy.supportDevice} value="DEMO-PC-047" />
          <Detail label={copy.supportSerial} value="DEMO-SERIAL-047" />
          <Detail
            label={copy.supportWindows}
            value="Windows 11 Enterprise (demo)"
          />
          <Detail label={copy.supportNetwork} value={copy.supportIp} />
        </dl>
      </details>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
