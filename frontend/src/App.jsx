import { useMemo, useState } from 'react';
import arrowDownIcon from '../dist/arrow-down-svgrepo-com.svg';
import AppFooter from './AppFooter';
import AppHeader from './AppHeader';
import ChatPanel from './ChatPanel';
import OceanSidebar from './OceanSidebar';
import './App.css';

const recentChats = [
  { title: 'Moon Analyze', time: '15m ago' },
  { title: 'General Analyze', time: '1h ago' },
  { title: 'Rekt Analyze', time: '1week ago' },
];

function App() {
  const [selectedChatTitle, setSelectedChatTitle] = useState(recentChats[0].title);

  const selectedChat = useMemo(
    () => recentChats.find((chat) => chat.title === selectedChatTitle) ?? recentChats[0],
    [selectedChatTitle]
  );

  return (
    <div className="app-container">
      <AppHeader />

      <div className="content-shell">
        <div className="content-layout">
          <OceanSidebar
            chats={recentChats}
            selectedChatTitle={selectedChat.title}
            onSelectChat={setSelectedChatTitle}
          />
          <ChatPanel arrowDownIcon={arrowDownIcon} title={selectedChat.title} />
        </div>
      </div>

      <AppFooter />
    </div>
  );
}

export default App;
