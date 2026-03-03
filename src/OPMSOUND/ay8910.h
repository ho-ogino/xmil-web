#ifndef AY8910_H
#define AY8910_H

void AY8910Write(int a,int data);
int AY8910Read(void);

void AY8910_reset(void);
int AY8910_init(int clock,int sample_rate);
void AY8910Update(INT32 *buffer,int length);
void AY8910_set_clock(int clock,int rate);

void AY8910_set_puchi_noize(int value);
#endif
