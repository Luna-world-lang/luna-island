const tierOrder = ['SSS','SS','S','A','B','C','D','E','닭','나뭇가지'];

export function personalRecords(streamers, history) {
  const records = streamers.map(p => ({...p, games:0, wins:0, rankTotal:0}));
  const byName = new Map(records.map(p => [p.name,p]));
  let excludedEvents = 0;
  for (const event of history) {
    if (event.deleted) continue;
    if (!Array.isArray(event.rounds) || !event.rounds.length) { excludedEvents++; continue; }
    const seen = new Set();
    for (const row of event.rounds) {
      const rank = Number(row.placement);
      if (!Number.isInteger(rank) || rank < 1 || !Array.isArray(row.members)) continue;
      for (const name of row.members) {
        const person = byName.get(name), key = JSON.stringify([row.round,name]);
        if (!person || seen.has(key)) continue;
        seen.add(key); person.games++; person.wins += rank === 1 ? 1 : 0; person.rankTotal += rank;
      }
    }
  }
  return {records: records.map(p => ({...p, winRate:p.games ? p.wins/p.games*100 : null, averageRank:p.games ? p.rankTotal/p.games : null})), excludedEvents};
}

export function sortPersonalRecords(records, key='name', direction='asc') {
  const sign = direction === 'asc' ? 1 : -1;
  const value = p => key === 'tier' ? (tierOrder.includes(p.tier) ? tierOrder.indexOf(p.tier) : null) : p[key];
  return [...records].sort((a,b) => {
    const x=value(a), y=value(b);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    const diff = x == null ? 0 : key === 'name' ? x.localeCompare(y,'ko') : x-y;
    return diff*sign || a.name.localeCompare(b.name,'ko');
  });
}
