# Otimizações de Refresh Rate e requestAnimationFrame

## 🖥️ Sistema de Detecção Automática de Refresh Rate

### Implementação

```typescript
// Detecta automaticamente a taxa de refresh do monitor
const detectRefreshRate = useCallback(() => {
  const frameHistory = frameTimeHistoryRef.current;
  if (frameHistory.length >= 60) {
    // 60 frames para medição precisa
    const avgFrameTime =
      frameHistory.reduce((a, b) => a + b, 0) / frameHistory.length;
    const detectedRefreshRate = Math.round(1000 / avgFrameTime);

    // Valida contra taxas comuns (60, 75, 90, 120, 144, 165, 240Hz)
    const commonRates = [60, 75, 90, 120, 144, 165, 240];
    const closestRate = commonRates.reduce((prev, curr) =>
      Math.abs(curr - detectedRefreshRate) <
      Math.abs(prev - detectedRefreshRate)
        ? curr
        : prev,
    );

    refreshRateRef.current = closestRate;
  }
}, []);
```

### Taxas Suportadas

- **60Hz**: Padrão (monitores básicos)
- **75Hz**: Monitores intermediários
- **90Hz**: Alguns laptops gaming
- **120Hz**: Gaming/smartphones high-end
- **144Hz**: Gaming padrão
- **165Hz**: Gaming high-end
- **240Hz**: E-sports/competitive

## ⚡ requestAnimationFrame Adaptativo

### 🎯 **Estratégia por Dispositivo**

#### Desktop - Aproveitamento Máximo

```typescript
// Sincroniza automaticamente com qualquer refresh rate
const gameLoop = (currentTime: number) => {
  // Sem limitação artificial - usa taxa nativa do monitor
  const deltaTime = currentTime - lastTime;

  updateGame(deltaTime); // Baseado em tempo, não frames
  render();

  requestAnimationFrame(gameLoop); // Próximo frame na taxa do monitor
};
```

#### Mobile - FPS Desbloqueado

```typescript
// FPS desbloqueado para aproveitamento máximo
const targetFrameTime = 0; // Unlimited FPS

const gameLoop = (currentTime: number) => {
  // Sem limitação de frames - máximo desempenho
  updateGame(deltaTime);
  render();
  requestAnimationFrame(gameLoop);
};
```

## 🔧 Frame Skipping Inteligente

### Algoritmo Adaptativo

```typescript
// Ajusta frame skipping baseado na taxa de refresh e tamanho do canvas
const isLargeCanvas = canvas.width > 1000 || canvas.height > 600;
const currentRefreshRate = refreshRateRef.current;

let frameSkip = 1;
if (isLargeCanvas) {
  if (currentRefreshRate >= 144)
    frameSkip = 3; // 144Hz+ → ~48 FPS efetivo
  else if (currentRefreshRate >= 120)
    frameSkip = 2; // 120Hz → ~60 FPS efetivo
  else frameSkip = 1; // 60-90Hz → taxa completa
}
```

### Benefícios por Refresh Rate

| Monitor   | Canvas Pequeno | Canvas Grande | FPS Efetivo |
| --------- | -------------- | ------------- | ----------- |
| **60Hz**  | 60 FPS         | 60 FPS        | 60          |
| **120Hz** | 120 FPS        | 60 FPS        | 60-120      |
| **144Hz** | 144 FPS        | 48 FPS        | 48-144      |
| **240Hz** | 240 FPS        | 80 FPS        | 80-240      |

## 📊 Delta Time Baseado em Tempo Real

### Problema Resolvido

```typescript
// ❌ ANTES: Movimento dependente de frame rate
player.x += 5; // Mais rápido em 144Hz, mais lento em 60Hz

// ✅ DEPOIS: Movimento consistente independente do FPS
const speed = 300; // pixels por segundo
player.x += speed * (deltaTime / 1000); // Sempre 300px/s
```

### Implementação Robusta

```typescript
// Safeguards contra valores extremos
const rawDeltaTime = currentTime - lastTime;
const deltaTime = lastTime === 0 ? 16.67 : Math.min(rawDeltaTime, 33.33);

// Previne jumps enormes (ex: tab foi minimizada)
// Limita a ~30 FPS mínimo para física estável
```

## 🎮 WebGL Adapativo

### Desktop WebGL

```typescript
// Roda na taxa máxima do monitor
const animate = (currentTime: number) => {
  updateUniforms(currentTime);
  renderer.render(scene, camera);
  requestAnimationFrame(animate); // Sync com monitor
};
```

### Mobile WebGL

```typescript
// FPS desbloqueado para aproveitamento máximo
const targetFrameTime = 0;

const animate = (currentTime: number) => {
  // Sem limitação - máxima taxa de refresh
  render(); // FPS máximo possível
  requestAnimationFrame(animate);
};
```

## 📱 Configurações por Contexto

### Gaming Desktop (High-end)

- **Refresh Rate**: 144Hz-240Hz detectado automaticamente
- **Frame Limiting**: Nenhum
- **Delta Time**: Precisão total
- **WebGL**: Máxima taxa

### Office Desktop (Padrão)

- **Refresh Rate**: 60Hz-75Hz
- **Frame Limiting**: Nenhum necessário
- **Delta Time**: Estável
- **WebGL**: Taxa nativa

### Mobile (Qualquer)

- **Refresh Rate**: Detectado e aproveitado completamente
- **Frame Limiting**: Removido - FPS desbloqueado
- **Delta Time**: Preciso e desbloqueado
- **WebGL**: FPS máximo possível

## 🔍 Monitoramento e Debug

### Display de Informações

```typescript
// Mostra FPS atual + refresh rate detectado
FPS: 144 (Mobile) | 144Hz  // Mobile com refresh detectado
FPS: 237 | 240Hz           // Desktop high-end
FPS: 60 | 60Hz             // Desktop padrão
```

### Console Logging

```typescript
// Logs automáticos na detecção
🖥️ Detected monitor refresh rate: 144Hz (measured: 142Hz)
🖥️ Detected monitor refresh rate: 60Hz (measured: 59Hz)
```

## ⚡ Benefícios da Implementação

### 🎯 **Performance**

- **High Refresh Monitors**: Aproveita completamente 120Hz+, 144Hz+, 240Hz+
- **Standard Monitors**: Estabilidade máxima em 60Hz
- **Mobile**: Economia de bateria com 45 FPS cap

### 🎮 **Experiência de Usuário**

- **Movimento Fluido**: Sincronizado com qualquer taxa de refresh
- **Consistência**: Física e animações idênticas em qualquer FPS
- **Responsividade**: Input lag mínimo em monitores high-end

### 🔋 **Eficiência**

- **Desktop**: Zero overhead - roda na taxa ótima
- **Mobile**: Economia máxima de bateria e temperatura
- **Adaptive**: Inteligência automática sem configuração manual

## 🎛️ Variable Refresh Rate (VRR)

### G-Sync / FreeSync

```typescript
// requestAnimationFrame automaticamente se adapta a VRR
// Sem configuração necessária - funciona automaticamente
// Suporte para 30-240Hz dinâmico
```

### Benefícios com VRR

- **Tear-free**: Sem tearing mesmo com FPS variável
- **Low Latency**: Latência mínima
- **Smooth**: Transições fluidas entre taxas

## 🚀 Próximas Melhorias

### Detecção de Hardware

- **GPU Detection**: Ajustar configurações baseado na GPU
- **Performance Profiling**: Auto-ajuste baseado em performance real
- **Memory Usage**: Monitoring automático de VRAM

### Advanced Features

- **Frame Pacing**: Distribuição uniforme de frames
- **Predictive Rendering**: Antecipação de próximos frames
- **Multi-threading**: Web Workers para cálculos paralelos

---

O sistema agora se adapta automaticamente a qualquer refresh rate (60Hz, 120Hz, 144Hz, 240Hz+) mantendo performance ótima e experiência consistente para todos os usuários.
