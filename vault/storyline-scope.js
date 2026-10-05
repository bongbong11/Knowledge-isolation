// Optional Hub capability. Standalone and older Hub installations keep their
// existing message validation. Never send chat names to models or diagnostics.
export function knowledgeSourceScope(context) {
    try {
        const scope=globalThis.SceneReaderHub?.companionStorage?.scope?.({metadata:context.chatMetadata});
        return typeof scope?.chatRef==='string'?{chatRef:scope.chatRef}:{};
    }catch{return {};}
}
export const knowledgeReceiptKey=identity=>(identity.originChatRef?identity.originChatRef+':':'')+identity.prefix;
