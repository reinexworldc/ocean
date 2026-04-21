import { useLayoutEffect, useRef, useState } from 'react';

import './AppFooter.css';

function AppFooter() {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [caretOffset, setCaretOffset] = useState(0);
  const measureRef = useRef(null);

  useLayoutEffect(() => {
    if (!measureRef.current) {
      return;
    }

    const measureWidth = measureRef.current.getBoundingClientRect().width;

    setCaretOffset(value.length === 0 ? 0 : Math.max(0, measureWidth - 1));
  }, [value]);

  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <div className="app-footer__inputContainer">
          {(isFocused || value.length === 0) && (
            <div
              className="app-footer__inputIcon"
              style={{ left: `${caretOffset}px` }}
              aria-hidden="true"
            />
          )}
          <input
            type="text"
            className="app-footer__input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {value.length === 0 && (
            <span className="app-footer__prompt" aria-hidden="true">
              Ask Ocean...
            </span>
          )}
          <span ref={measureRef} className="app-footer__inputMeasure" aria-hidden="true">
            {value.replace(/ /g, '\u00A0')}
          </span>
        </div>
      </div>
    </footer>
  );
}

export default AppFooter;
