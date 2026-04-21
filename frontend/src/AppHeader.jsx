import profileAvatar from '../dist/7057085c17f5ee4adabf4d6b72afed76.jpg';
import coinbaseLogo from '../dist/coinbase-v2-svgrepo-com (1).svg';
import './AppHeader.css';

function AppHeader() {
  return (
    <header className="header">
      <div className="logo-container">
        <span className="logo-ocean">OCEAN</span>
        <span className="logo-chat">CHAT</span>
      </div>

      <div className="header-right">
        <div className="user-controls">
          <div className="credits-badge">74 CREDITS LEFT</div>
          <div className="profile-button" aria-hidden="true">
            <img
              src={profileAvatar}
              alt="Profile"
              className="profile-pic"
            />
          </div>
        </div>

        <div className="account-panel">
          <div className="account-panel__header">
            <div className="greeting">HI, REINEX!</div>
            <div className="email">REINEX@ARC.COM</div>
            <button type="button" className="settings-btn">
              SETTINGS
            </button>
          </div>

          <div className="account-panel__section">
            <div className="section-title">EXTERNAL WALLET</div>
            <div className="wallet-address">
              <img
                src={coinbaseLogo}
                alt="Coinbase"
                className="wallet-icon"
              />
              <span>0X123ABC...</span>
            </div>
          </div>

          <div className="account-panel__footer">
            <button type="button" className="sign-out-btn">
              SIGN OUT
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
