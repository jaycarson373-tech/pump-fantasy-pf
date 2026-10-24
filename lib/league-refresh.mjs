export async function readLeagueSnapshot({ fetcher = fetch, signal } = {}) {
  const read = async (path) => {
    const response = await fetcher(path, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('League data did not refresh.');
    return response.json();
  };
  const [players, standings] = await Promise.allSettled([read('/api/players'), read('/api/standings')]);
  return {
    players: players.status === 'fulfilled' ? players.value : null,
    standings: standings.status === 'fulfilled' ? standings.value : null,
    partial: players.status === 'rejected' || standings.status === 'rejected',
  };
}
