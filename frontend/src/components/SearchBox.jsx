import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/*
  SearchBox component
  - Debounced input (300ms) to avoid hammering the API
  - Fetches suggestions from /suggest?q=<prefix>
  - Keyboard navigation: up/down arrows, enter to select
  - Click on suggestion to search
*/

function SearchBox({ onSearch }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [lastLatency, setLastLatency] = useState(null);
  const [lastSource, setLastSource] = useState(null);

  const inputRef = useRef(null);
  const debounceTimer = useRef(null);

  // debounced fetch suggestions
  const fetchSuggestions = useCallback(async (prefix) => {
    if (!prefix || prefix.length < 1) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/suggest?q=${encodeURIComponent(prefix)}`);
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setLastLatency(data.latencyMs);
      setLastSource(data.source);
      setShowDropdown(true);
      setSelectedIndex(-1);
    } catch (err) {
      console.error('Suggestion fetch failed:', err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // handle input change with debounce
  function handleInputChange(e) {
    const value = e.target.value;
    setQuery(value);

    // clear previous debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // debounce 300ms
    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(value.trim());
    }, 300);
  }

  // handle keyboard navigation
  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        submitSearch(suggestions[selectedIndex].query);
      } else if (query.trim()) {
        submitSearch(query.trim());
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  function submitSearch(searchQuery) {
    setQuery(searchQuery);
    setShowDropdown(false);
    setSuggestions([]);
    onSearch(searchQuery);
  }

  // close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // format large numbers for display
  function formatCount(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
  }

  return (
    <div className="search-box" ref={inputRef}>
      <div className="search-input-wrapper">
        <input
          type="text"
          className="search-input"
          placeholder="Type to search..."
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          autoFocus
        />
        <button
          className="search-btn"
          onClick={() => query.trim() && submitSearch(query.trim())}
        >
          Search
        </button>
        {loading && <span className="loading-dot">●</span>}
      </div>

      {lastLatency !== null && (
        <div className="latency-info">
          Suggestion Latency: {lastLatency}ms | Cache Source: {lastSource}
        </div>
      )}

      {showDropdown && suggestions.length > 0 && (
        <ul className="suggestions-dropdown">
          {suggestions.map((item, index) => (
            <li
              key={item.query}
              className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onMouseDown={() => submitSearch(item.query)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="suggestion-text">{item.query}</span>
              <span className="suggestion-count">{formatCount(item.count)}</span>
            </li>
          ))}
        </ul>
      )}

      {showDropdown && suggestions.length === 0 && query.length > 0 && !loading && (
        <div className="no-suggestions">No suggestions found</div>
      )}
    </div>
  );
}

export default SearchBox;
