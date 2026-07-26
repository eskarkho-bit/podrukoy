import { useAppState } from '../../components/AppState';
import { MessagesScreen } from '../../screens/MessagesScreen';

export default function MessagesRoute() {
  const s = useAppState();

  return (
    <MessagesScreen
      threads={s.threads}
      typingThreadId={s.typingThreadId}
      openRequestId={s.openThreadRequest}
      onOpenRequestHandled={s.clearOpenThreadRequest}
      onOpenThread={s.markThreadRead}
      onSendMessage={s.sendMessage}
      onThreadOpenChange={s.setChatOpen}
    />
  );
}
