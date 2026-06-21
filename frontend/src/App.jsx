import { useState, useEffect } from 'react';
import SearchBox from './components/SearchBox';
import TrendingSection from './components/TrendingSection';
import StatsPanel from './components/StatsPanel';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  const [searchResult, setSearchResult] = useState(null);
  const [trending, setTrending] = useState([]);

  // fetch trending searches on load and periodically
  useEffect(() => {
    fetchTrending();
    const interval = setInterval(fetchTrending, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchTrending() {
    try {
      const res = await fetch(`${API_URL}/trending`);
      const data = await res.json();
      setTrending(data.trending || []);
    } catch (err) {
      console.error('Failed to fetch trending:', err);
    }
  }

  async function handleSearch(query) {
    try {
      const res = await fetch(`${API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      setSearchResult(data);

      // refresh trending after a search
      setTimeout(fetchTrending, 500);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResult({ error: 'Search failed' });
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Search Typeahead</h1>
        <p className="subtitle">Start typing to see suggestions</p>
      </header>

      <main className="app-main">
        <div className="search-section">
          <SearchBox onSearch={handleSearch} />

          {searchResult && (
            <div className="search-result">
              {searchResult.error ? (
                <p className="error">{searchResult.error}</p>
              ) : (
                <p className="success">
                  ✓ Searched for &ldquo;<strong>{searchResult.query}</strong>&rdquo; &mdash; {searchResult.message}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="sidebar">
          <TrendingSection trending={trending} onSearch={handleSearch} />
          <StatsPanel />
        </div>
      </main>
    </div>
  );
}

export default App;
