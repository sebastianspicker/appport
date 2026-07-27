import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="page-title">
        <div className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className={styles.eyebrow}>Managed by Relution</p>
        <h1 id="page-title">Appport</h1>
        <p>Self-service software for managed Windows devices.</p>
        <p>Install and update software approved through Relution.</p>
        <p className={styles.help}>
          Open the Windows application to sign in. This broker does not provide
          a browser software catalog.
        </p>
      </section>
    </main>
  );
}
