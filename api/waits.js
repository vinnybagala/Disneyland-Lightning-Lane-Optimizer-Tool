export default async function handler(req, res) {
  const { park } = req.query;
  try {
    const response = await fetch(`https://queue-times.com/parks/${park}/queue_times.json`);
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
}
