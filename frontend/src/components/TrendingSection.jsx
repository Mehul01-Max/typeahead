/*
  TrendingSection component
  - Shows currently trending search queries
  - Click a trending query to search for it
*/

function TrendingSection({ trending, onSearch }) {
  if (!trending || trending.length === 0) {
    return (
      <div className="trending-section">
        <h3>🔥 Trending Searches</h3>
        <p className="trending-empty">
          No trending searches yet. Try searching for something!
        </p>
      </div>
    );
  }

  return (
    <div className="trending-section">
      <h3>🔥 Trending Searches</h3>
      <ul className="trending-list">
        {trending.map((item, index) => (
          <li
            key={item.query}
            className="trending-item"
            onClick={() => onSearch(item.query)}
          >
            <span className="trending-rank">{index + 1}</span>
            <span className="trending-query">{item.query}</span>
            <span className="trending-score">
              score: {item.trendingScore.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TrendingSection;
