export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <h1 className="wordmark" aria-label="WHYTHEWEAKEST OS"><b>whytheweakest . . .</b><span>[ editorial os ]</span></h1>
      {error && <p className="notice notice-warn">Ссылка устарела или уже использована. Запросите новую.</p>}
      <p>Чтобы войти, отправьте боту команду <code>/login</code> и откройте ссылку из ответа. Ссылка одноразовая и действует 5 минут.</p>
    </main>
  );
}
